package com.iykyk.collage

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.MediaMetadataRetriever
import android.net.Uri
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import kotlinx.coroutines.*
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.*

/**
 * FacePipelineModule — Expo-compatible React Native Native Module
 * Exposes on-device face detection, embedding, clustering pipeline to JS.
 *
 * Registered as a React Native module so it works with Expo Go custom build.
 */
class FacePipelineModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "FacePipeline"

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    private val detector = FaceDetection.getClient(
        FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
            .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
            .setContourMode(FaceDetectorOptions.CONTOUR_MODE_NONE)
            .setMinFaceSize(0.08f)
            .build()
    )

    /**
     * Process a video file: extract frames, detect faces, cluster by identity,
     * count appearances, select best representative shot per person.
     *
     * @param videoUri   content:// or file:// URI to the video
     * @param promise    resolves with JSON string of results
     */
    /**
     * Process a video file: extract frames, detect faces, cluster by identity,
     * count appearances, select best representative shot per person.
     *
     * @param videoUri   content:// or file:// URI to the video
     * @param promise    resolves with JSON string of results
     */
    @ReactMethod
    fun processVideo(videoUri: String, promise: Promise) {
        scope.launch {
            try {
                val results = runPipeline(videoUri) { stage, progress ->
                    // Emit progress back to JS
                    val map = Arguments.createMap()
                    map.putString("stage", stage)
                    map.putDouble("progress", progress)
                    reactContext
                        .emitDeviceEvent("FacePipelineProgress", map)
                }
                promise.resolve(results)
            } catch (e: Exception) {
                promise.reject("PIPELINE_ERROR", e.message ?: "Unknown error", e)
            }
        }
    }

    private suspend fun runPipeline(
        videoUri: String,
        onProgress: (stage: String, progress: Double) -> Unit
    ): String {
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(reactContext, Uri.parse(videoUri))
        } catch (e: Exception) {
            throw Exception("Cannot open video: ${e.message}")
        }

        val durationMs = retriever.extractMetadata(
            MediaMetadataRetriever.METADATA_KEY_DURATION
        )?.toLongOrNull() ?: throw Exception("Cannot read video duration")

        // Sample every 500ms (2 frames per second) for fine temporal resolution
        val frameIntervalMs = 500L
        val frameCount = (durationMs / frameIntervalMs).toInt().coerceAtLeast(1)

        onProgress("Extracting frames", 0.0)

        // --- Stage 1: Extract frames & detect faces ---
        data class FaceCandidate(
            val timeMs: Long,
            val frameIndex: Int,
            val face: Face,
            val bitmap: Bitmap,
            val quality: Float
        )

        val allCandidates = mutableListOf<FaceCandidate>()

        for (i in 0 until frameCount) {
            val timeMs = i * frameIntervalMs
            val bmp = retriever.getFrameAtTime(
                timeMs * 1000,
                MediaMetadataRetriever.OPTION_CLOSEST
            ) ?: continue

            val scaledBmp = scaleBitmap(bmp, 640)
            val image = InputImage.fromBitmap(scaledBmp, 0)

            try {
                val faces = detector.process(image).await()
                for (face in faces) {
                    val q = qualityScore(face)
                    allCandidates.add(FaceCandidate(timeMs, i, face, scaledBmp, q))
                }
            } catch (_: Exception) {}

            onProgress("Detecting faces", (i + 1).toDouble() / frameCount * 0.4)
        }

        retriever.release()

        if (allCandidates.isEmpty()) {
            return buildResult(emptyList(), emptyList())
        }

        onProgress("Computing embeddings", 0.4)

        // --- Stage 2: Embedding vectors from face geometry ---
        data class FaceWithEmbed(val candidate: FaceCandidate, val embedding: FloatArray)

        val embedded = allCandidates.mapIndexed { idx, c ->
            val emb = geometricEmbedding(c.face)
            onProgress("Computing embeddings", 0.4 + idx.toDouble() / allCandidates.size * 0.2)
            FaceWithEmbed(c, emb)
        }

        onProgress("Clustering identities", 0.6)

        // --- Stage 3: Agglomerative clustering (T=0.68 cosine similarity) ---
        val THRESHOLD = 0.68f
        val clusters = mutableListOf<MutableList<FaceWithEmbed>>()

        for (item in embedded) {
            var bestCluster: MutableList<FaceWithEmbed>? = null
            var bestSim = THRESHOLD

            for (cluster in clusters) {
                val centroid = centroid(cluster.map { it.embedding })
                val sim = cosineSimilarity(item.embedding, centroid)
                if (sim > bestSim) {
                    bestSim = sim
                    bestCluster = cluster
                }
            }

            if (bestCluster != null) {
                bestCluster.add(item)
            } else {
                clusters.add(mutableListOf(item))
            }
        }

        onProgress("Counting appearances", 0.8)

        // --- Stage 4: Count continuous appearance segments ---
        data class PersonResult(
            val id: String,
            val appearances: Int,
            val bestCandidate: FaceCandidate,
            val timeSegments: List<Pair<Long, Long>>
        )

        val results = clusters.mapIndexed { idx, cluster ->
            val sorted = cluster.sortedBy { it.candidate.frameIndex }
            val segs = continuousSegments(sorted.map { it.candidate.frameIndex }, sorted.map { it.candidate.timeMs })
            val best = cluster.maxByOrNull { it.candidate.quality }!!.candidate
            PersonResult("person_$idx", segs.size, best, segs)
        }.filter { it.appearances >= 1 }
            .sortedByDescending { it.appearances }

        onProgress("Building collage", 0.9)

        // --- Stage 5: Encode best frames as base64 for collage ---
        val personJsonList = results.mapIndexed { idx, p ->
            val bmpEncoded = encodeBitmapBase64(p.bestCandidate.bitmap, p.bestCandidate.face)
            val segsJson = JSONArray()
            p.timeSegments.forEach { (start, end) ->
                val seg = JSONObject()
                seg.put("startMs", start)
                seg.put("endMs", end)
                segsJson.put(seg)
            }
            val obj = JSONObject()
            obj.put("id", p.id)
            obj.put("appearanceCount", p.appearances)
            obj.put("bestFrameBase64", bmpEncoded)
            obj.put("qualityScore", p.bestCandidate.quality)
            obj.put("frontality", frontality(p.bestCandidate.face))
            obj.put("eyesOpen", eyesOpen(p.bestCandidate.face))
            obj.put("smiling", smiling(p.bestCandidate.face))
            obj.put("timeSegments", segsJson)
            obj
        }

        onProgress("Done", 1.0)
        return buildResult(personJsonList, results.map { it.appearances })
    }

    // ---------- Quality Scoring ----------

    private fun qualityScore(face: Face): Float {
        val f = frontality(face)
        val e = eyesOpen(face)
        val s = smiling(face)
        val sharpness = 1.0f
        return 0.35f * f + 0.30f * sharpness + 0.20f * e + 0.15f * s
    }

    private fun frontality(face: Face): Float {
        val yaw = abs(face.headEulerAngleY)
        val pitch = abs(face.headEulerAngleX)
        return (1f - (yaw / 90f).coerceIn(0f, 1f)) * (1f - (pitch / 45f).coerceIn(0f, 1f))
    }

    private fun eyesOpen(face: Face): Float {
        val l = face.leftEyeOpenProbability ?: 0.5f
        val r = face.rightEyeOpenProbability ?: 0.5f
        return (l + r) / 2f
    }

    private fun smiling(face: Face): Float = face.smilingProbability ?: 0.5f

    // ---------- Geometric Facial Embedding (32-d normalized) ----------

    private fun geometricEmbedding(face: Face): FloatArray {
        val bb = face.boundingBox
        val cx = bb.exactCenterX()
        val cy = bb.exactCenterY()
        val w = bb.width().toFloat().coerceAtLeast(1f)
        val h = bb.height().toFloat().coerceAtLeast(1f)

        val vec = FloatArray(32) { 0f }
        // 0-3: Aspect ratio and normalized face dimensions
        vec[0] = w / (w + h)
        vec[1] = h / (w + h)
        vec[2] = (face.headEulerAngleX + 90f) / 180f
        vec[3] = (face.headEulerAngleY + 90f) / 180f

        // Facial landmarks relative to face center
        val lms = face.allLandmarks
        lms.forEachIndexed { i, lm ->
            val baseIdx = 4 + i * 2
            if (baseIdx + 1 < 32) {
                vec[baseIdx] = (lm.position.x - cx) / w
                vec[baseIdx + 1] = (lm.position.y - cy) / h
            }
        }

        // Normalize vector to unit length for cosine similarity
        var norm = 0f
        for (v in vec) norm += v * v
        norm = sqrt(norm)
        if (norm > 0f) {
            for (i in vec.indices) vec[i] /= norm
        }
        return vec
    }

    private fun cosineSimilarity(a: FloatArray, b: FloatArray): Float {
        var dot = 0f; var na = 0f; var nb = 0f
        for (i in a.indices) {
            dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]
        }
        return if (na == 0f || nb == 0f) 0f else dot / (sqrt(na) * sqrt(nb))
    }

    private fun centroid(vecs: List<FloatArray>): FloatArray {
        val result = FloatArray(vecs[0].size) { 0f }
        vecs.forEach { v -> v.forEachIndexed { i, x -> result[i] += x } }
        return result.map { it / vecs.size }.toFloatArray()
    }

    // ---------- Appearance Segment Counting ----------

    private fun continuousSegments(
        frameIndices: List<Int>,
        timesMs: List<Long>
    ): List<Pair<Long, Long>> {
        if (frameIndices.isEmpty()) return emptyList()
        val GAP = 3 // frames without face = end of appearance
        val segs = mutableListOf<Pair<Long, Long>>()
        var segStart = timesMs[0]
        var prevIdx = frameIndices[0]

        for (i in 1 until frameIndices.size) {
            if (frameIndices[i] - prevIdx > GAP) {
                segs.add(segStart to timesMs[i - 1])
                segStart = timesMs[i]
            }
            prevIdx = frameIndices[i]
        }
        segs.add(segStart to timesMs.last())
        return segs
    }

    // ---------- Bitmap Utilities ----------

    private fun scaleBitmap(bmp: Bitmap, maxDim: Int): Bitmap {
        val ratio = maxDim.toFloat() / maxOf(bmp.width, bmp.height)
        if (ratio >= 1f) return bmp
        val w = (bmp.width * ratio).toInt()
        val h = (bmp.height * ratio).toInt()
        return Bitmap.createScaledBitmap(bmp, w, h, true)
    }

    private fun encodeBitmapBase64(bmp: Bitmap, face: Face): String {
        // Generous crop around face (2x bounding box), not tight
        val bb = face.boundingBox
        val pad = maxOf(bb.width(), bb.height())
        val left = (bb.left - pad * 0.5f).toInt().coerceAtLeast(0)
        val top = (bb.top - pad * 0.8f).toInt().coerceAtLeast(0)
        val right = (bb.right + pad * 0.5f).toInt().coerceAtMost(bmp.width)
        val bottom = (bb.bottom + pad * 0.3f).toInt().coerceAtMost(bmp.height)
        val w = (right - left).coerceAtLeast(1)
        val h = (bottom - top).coerceAtLeast(1)

        val cropped = Bitmap.createBitmap(bmp, left, top, w, h)
        val stream = java.io.ByteArrayOutputStream()
        cropped.compress(Bitmap.CompressFormat.JPEG, 80, stream)
        return android.util.Base64.encodeToString(stream.toByteArray(), android.util.Base64.NO_WRAP)
    }

    private fun buildResult(persons: List<JSONObject>, counts: List<Int>): String {
        val root = JSONObject()
        val arr = JSONArray()
        persons.forEach { arr.put(it) }
        root.put("persons", arr)
        root.put("totalAppearances", counts.sum())
        root.put("distinctPeople", persons.size)
        return root.toString()
    }

    override fun onCatalystInstanceDestroy() {
        scope.cancel()
        detector.close()
    }
}
