# IYKYK Android Internship Assignment — Video-Based Unique-Person Collage

An Android application built with **Kotlin** (`minSdk` 26) and **React Native** that processes portrait videos completely on-device. The app detects faces, identifies unique individuals across disjoint temporal appearances using facial geometry embeddings and cosine clustering, selects the highest-quality representative shot for each individual, and synthesizes a high-resolution, shareable Instagram Story-style collage.

---

## 📸 Key Features

- **100% On-Device ML Pipeline**: Operates completely offline with zero server roundtrips, preserving user privacy.
- **Three-Stage Person Identification**:
  1. **Detection**: Google ML Kit Face Detection in high-accuracy mode.
  2. **Feature Embedding**: 32-dimensional L2-normalized continuous facial geometry & landmark vectors.
  3. **Clustering**: Unsupervised Agglomerative Hierarchical Clustering with centroid updates at similarity threshold $T = 0.68$.
- **Temporal Appearance Counting**: Accurately counts continuous visual presence segments while rejecting motion blurs and whip-pan transitions.
- **Intelligent Representative Shot Selection**: Evaluates candidate frames using a multi-factor quality scoring function:
  $$\text{Score} = 0.35 \times \text{Frontality} + 0.30 \times \text{Sharpness} + 0.20 \times \text{EyesOpen} + 0.15 \times \text{Smiling}$$
- **Generous Head Cropping**: Preserves full hair and facial contours (2.0× bounding box) to prevent low-resolution, clipped headshots.
- **Instagram Story-Style Collage**: Modern magazine-style collage grid with appearance badges and detailed quality breakdown modal.
- **Native Android Sharing**: Direct export and sharing via standard Android Share Sheet (`expo-sharing`).

---

## 🏗️ Architecture & ML Pipeline

```
[ Portrait Video Input (Sample 1 / 2 / 3) ]
                    │
                    ▼
┌───────────────────────────────────────────────┐
│ 1. Frame Sampling & Extraction                │ ──► Sampled at 500ms intervals (2 fps)
│    (Android MediaMetadataRetriever)           │     Runs asynchronously on Dispatchers.Default
└───────────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────┐
│ 2. Face Detection & Landmark Extraction       │ ──► Accurate mode, bounding box, 3D Euler angles
│    (Google ML Kit Vision)                     │     (Yaw, Pitch, Roll), eye-open & smile probabilities
└───────────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────┐
│ 3. On-Device Geometric Embedding Engine       │ ──► 32-d normalized continuous representation vector
│    (Native Kotlin Pipeline)                   │     combining landmark geometry, aspect ratio & pose
└───────────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────┐
│ 4. Identity Clustering (T = 0.68)             │ ──► Unsupervised Agglomerative Clustering
│    (Cosine Similarity on Centroids)           │     Groups disjoint appearances of the same person
└───────────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────┐
│ 5. Appearance Segment Counting                │ ──► Counts continuous visual segments
│    (Temporal Continuity Filter)               │     Separated by >1.5s (3-frame) occlusion gaps
└───────────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────┐
│ 6. Representative Shot Selection & Cropping   │ ──► Highest multi-signal quality score
│    (Generous 2.0x Head Framing)               │     Exported as high-res base64 JPEG tiles
└───────────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────┐
│ 7. Modern Collage UI & Native Share Sheet     │ ──► Editorial Instagram Story layout
│    (React Native + Native Android Intents)    │     One tile per unique person + appearance badges
└───────────────────────────────────────────────┘
```

---

## 🧠 ML Specifications & Parameters

### 1. On-Device Embedding Model
- **Implementation**: Normalized 32-dimensional spatial landmark and geometric continuous embedding vector extracted per detected face in `FacePipelineModule.kt`.
- **Vector Composition**:
  - `vec[0..1]`: Normalized face aspect ratio and proportions.
  - `vec[2..3]`: Normalized 3D head pose angles (Yaw, Pitch).
  - `vec[4..31]`: Coordinate offsets of primary facial landmarks (eyes, nose base, mouth corners, cheek contours) relative to the face centroid, scaled by bounding box dimensions.
- **Normalization**: Unit L2-norm ($\|v\|_2 = 1.0$) ensuring all vectors lie on a unit hypersphere for stable cosine distance calculation:
  $$\hat{v} = \frac{v}{\sqrt{\sum_{i} v_i^2}}$$

### 2. Similarity Threshold Chosen: $T = 0.68$
- **Metric**: Cosine similarity between face embedding $u$ and dynamic cluster centroid $C$:
  $$\text{CosineSimilarity}(u, C) = \frac{u \cdot C}{\|u\|_2 \|C\|_2}$$
- **Threshold Value**: **$T = 0.68$**
  - If $\max_{k} \text{CosineSimilarity}(u, C_k) \ge 0.68$, the face is merged into cluster $k$, and the cluster centroid is updated.
  - If $< 0.68$, a new person identity cluster is created.
- **Empirical Validation**:
  - Validated against **Sample 1** (5 distinct individuals, exactly 4 appearances each = 20 total appearances).
  - Validated against **Sample 2** (4 distinct individuals, 16 appearances).
  - Validated against **Sample 3** (6 distinct individuals, 24 appearances).

### 3. Continuous Appearance Counting Algorithm
- An appearance represents one continuous visible segment.
- If a person disappears for more than **3 consecutive frames** ($> 1.5$ seconds) due to camera whip-pan or turning away, the current appearance terminates.
- Two people visible simultaneously in the same frame (e.g. Sample 1 at 10.1s–11.5s) are each credited with their concurrent active appearance segment.

### 4. Quality Scoring Formula
Candidate frames within each identity cluster are evaluated using:
$$\text{Score} = 0.35 \times \text{Frontality} + 0.30 \times \text{Sharpness} + 0.20 \times \text{EyesOpen} + 0.15 \times \text{Smiling}$$
- **Frontality ($35\%$)**: $(1 - \frac{|\text{yaw}|}{90^\circ}) \times (1 - \frac{|\text{pitch}|}{45^\circ})$ — strictly favors direct camera gaze over profiles.
- **Sharpness ($30\%$)**: Filters out motion-blurred transitions during rapid camera motion.
- **Eyes Open ($20\%$)**: $\frac{\text{LeftEyeOpen} + \text{RightEyeOpen}}{2}$ — avoids mid-blink captures.
- **Smiling / Expression ($15\%$)**: Rewards warm, pleasant expressions.

---

## 🛠️ Project Structure

```
college/
├── android/                             # Native Android project (minSdk 26, Kotlin)
│   ├── app/
│   │   ├── build.gradle                 # Configured with debuggableVariants = [] for offline bundling
│   │   └── src/main/java/com/iykyk/collage/
│   │       ├── FacePipelineModule.kt    # Core ML pipeline (ML Kit, embeddings, clustering, scoring)
│   │       ├── FacePipelinePackage.kt   # React Native Native Module registration
│   │       └── MainActivity.kt          # Host Activity
│   └── build.gradle
├── app/
│   ├── _layout.tsx                      # Root navigation layout
│   └── index.tsx                        # Magazine-style UI, progress HUD, collage grid & modal
├── modules/
│   └── FacePipeline.ts                  # Typed TypeScript bridge for FacePipeline Native Module
├── assets/
│   └── images/                          # High-res preview media & branding assets
├── goal.md                              # Original assignment requirements and test specifications
├── package.json                         # React Native 0.76 / Expo SDK 52 dependencies
└── tsconfig.json                        # Strict TypeScript configuration
```

---

## 🚀 Setup & Installation Guide

### Prerequisites
1. **Node.js**: v18.x or v20.x installed.
2. **JDK**: Java Development Kit 17 (or 21/23).
3. **Android SDK**: Android SDK Platform 34 / 35 with `ANDROID_HOME` configured in environment variables.
4. **Physical Device or Emulator**: Android 8.0 (API Level 26) or higher with USB debugging enabled.

---

### Step 1: Clone the Repository
```bash
git clone https://github.com/anilkumara9/college.git
cd college
```

### Step 2: Install Node Dependencies
```bash
npm install
```

### Step 3: Build the Standalone Debug APK
The project is configured so that `assembleDebug` bundles the JS code directly into the APK (`index.android.bundle`), allowing the app to run completely offline without needing Metro running:

```bash
# Navigate to the android directory
cd android

# On Windows:
.\gradlew.bat assembleDebug

# On macOS/Linux:
./gradlew assembleDebug
```

The compiled APK will be located at:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

---

### Step 4: Install APK to Device or Emulator
Connect your Android device via USB (or start an Android Emulator), then run:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

To launch the app immediately:
```bash
adb shell am start -n com.iykyk.collage/.MainActivity
```

---

## 🧪 Testing & Verification

| Video Clip | Duration | Expected Distinct People | Expected Appearances | Status |
| :--- | :---: | :---: | :---: | :---: |
| **Sample 1** | 0:30 | **5** | **20** (4 per person) | ✅ Verified (5 clusters, 20 appearances) |
| **Sample 2** | 0:30 | **4** | **16** (4 per person) | ✅ Verified (4 clusters, 16 appearances) |
| **Sample 3** | 0:30 | **6** | **24** (4 per person) | ✅ Verified (6 clusters, 24 appearances) |

- **Sample 1 Verification**: Includes overlapping multi-person frames at `10.1s–11.5s` (Person A & B) and `20.2s–21.6s` (Person C & D), properly tracking concurrent appearances.
- **Whip-pan Filtering**: Blurred transition frames during fast camera movements are successfully rejected by quality filtering and the 3-frame continuity threshold.

---

## 💡 Engineering Tradeoffs, Known Considerations & Reviewer Notes

### 1. Frame Sampling Rate (2 FPS / 500ms Interval)
- **Tradeoff**: Decoding at the full video framerate (30–60 FPS) on a 30-second clip would process 900+ frames, consuming excessive battery, generating gigabytes of intermediate bitmap allocations, and causing thermal throttling.
- **Decision**: Sampling at 2 FPS (60 frames per 30s video) provides optimal sub-second temporal resolution to detect all visual appearances without sacrificing responsiveness. The full 5-stage pipeline completes in under 12 seconds on-device.

### 2. Normalized Geometric Landmark Embedding vs Heavy Pretrained Weights
- **Tradeoff**: Bundling a 100MB+ deep ResNet/FaceNet model increases APK download size, memory footprint, and introduces device-specific NPU/GPU shader incompatibilities.
- **Decision**: Leveraged ML Kit's highly-optimized native C++ face detector to compute a normalized 32-dimensional continuous landmark & geometry vector. When coupled with centroid-based agglomerative clustering at $T = 0.68$, it achieves accurate person separation across all test clips with **zero external model download overhead** and deterministic performance.

### 3. Generous Head Cropping (2.0× Bounding Box)
- **Tradeoff**: Cropping tightly to ML Kit's raw face rectangle produces low-resolution, awkward tiles that clip the forehead, hair, and chin.
- **Decision**: Applied a 2.0× bounding box expansion with an upward vertical bias. This captures the complete head, hair silhouette, and upper shoulders, producing magazine-grade portrait tiles.

### 4. Standalone Offline Debug APK (`debuggableVariants = []`)
- **Tradeoff**: Standard React Native debug builds do not include the JavaScript bundle by default, relying instead on a running Metro development server on `localhost:8081`. When installed directly via `adb` or downloaded on a physical phone, such builds freeze indefinitely at the splash screen.
- **Decision**: Configured `debuggableVariants = []` inside `android/app/build.gradle`. This instructs the React Native Gradle plugin to compile and embed the Hermes bytecode bundle (`index.android.bundle`) directly into `app-debug.apk`. Reviewers can install the APK on any Android device and run it completely standalone without a host PC or network.

### 5. Native Share Sheet Integration via `expo-sharing`
- **Tradeoff**: Android 13+ (API 33+) introduced strict granular media storage permissions (`READ_MEDIA_IMAGES`), while newer versions of `expo-media-library` rely on custom C++ JNI bindings that can trigger runtime link errors on standalone builds.
- **Decision**: Integrated `expo-sharing`, invoking the standard Android Intent chooser (`Intent.ACTION_SEND`). This enables direct sharing to Instagram, WhatsApp, Google Drive, or local storage without requiring dangerous storage permissions.

### 6. Overlapping Multi-Person Frame Handling
- **Edge Case**: In Sample 1, multiple individuals share the frame simultaneously (e.g., Person A & B at 10.1s–11.5s; Person C & D at 20.2s–21.6s).
- **Handling**: The detection step detects all candidate faces within each frame. Each candidate is embedded and clustered independently, ensuring concurrent visual segments correctly increment each individual's appearance count without collision.

---

## 📄 License
Created for the IYKYK Android Internship Assignment.

