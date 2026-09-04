iykyk Android Internship Assignment
Video-based unique-person collage
What to build
Build an Android app that processes the supplied portrait videos on-device, detects faces, identifies the same person across separate appearances, chooses a strong representative shot for each person, and creates a collage that can be saved and shared.
Requirements
Process any similar portrait video; the three supplied clips are the test set, so do not hardcode their results.
Load the selected video and show clear processing progress.
Keep processing off the main thread so the app stays responsive.
Live camera recording is not required and will not be evaluated.
Use face detection, face embeddings, and clustering to group appearances of the same person. All three stages are required.
Show each person's appearance count. Create one collage for each video, with every person detected in that video shown exactly once.
Choose a representative shot for each person. Judge each candidate shot using face attributes such as frontality (how front-facing the head pose is), sharpness (in focus, not motion-blurred), eyes open, and smiling / expression probability — favouring frontal, crisp, eyes-open, pleasant shots. Prefer a source frame where the full face is visible; avoid clipped faces and closed eyes where possible.
Create a good-looking, presentable, shareable collage. Be creative; a popular Instagram Story collage format is a useful reference.
Do not crop tightly to the detected face bounding box: it produces low-resolution, poor-quality tiles. Use the full frame, or crop generously around the face.
Let the user save the collage to the gallery and share it through the standard Android share sheet.
Stack and constraints
Kotlin, minSdk 26. Compose or XML is your choice.
ML Kit is encouraged for face detection. Use an on-device embedding model and document it in the README.
Everything must run on-device. There is no backend.
Time-box the assignment to 12-15 hours across the four days. Prioritise a working end-to-end flow.
Test videos
Use all three 30-second portrait clips: Sample 1 · Sample 2 · Sample 3 · Drive folder
How counting works
An appearance is one continuous visible segment: it starts when a person's face becomes clearly visible and ends when it is no longer clearly visible. Blurred whip-pan passes count for nobody. Two clearly visible people in one segment count as one appearance each.
Sample 1 worked example: five distinct people, each appearing four times, for 20 appearances total. A and B share the frame at 10.1-11.5s; C and D share it at 20.2-21.6s. Test on Samples 2 and 3 too; their counts are not provided.
How you'll be judged
Identity grouping and appearance-count accuracy: 50%
Code quality and architecture: 30%
App usability, representative-shot quality, and collage presentation: 20%
Submit by
Sunday, 6 September 2026, 11:59 PM IST. Nothing will be accepted after the deadline.
Submit here: Git repository; README with build/setup steps, embedding model used, and similarity threshold chosen; working debug APK; and a plain screen recording of the end-to-end flow, up to 60 seconds. No narration or editing is required: show processing, appearance counts, and the finished collage. The recording must clearly show the generated collage for each of the three sample videos, on screen and legible; hold on each long enough to review.