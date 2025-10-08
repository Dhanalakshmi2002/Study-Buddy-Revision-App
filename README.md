
# Study-Buddy-Revision-App
StudyBuddy: AI-Powered Coursebook Revision App
StudyBuddy is a fully functional, responsive web application designed to help school students revise from their coursebooks by generating instant, tailored quizzes and providing a virtual teaching companion.

This project was built entirely within a single React file (StudyBuddy.jsx) following the platform constraints and prioritising the aggressive use of LLMs for core features.

🚀 Setup and How to Run
This application is a single-file React component (StudyBuddy.jsx).

Technical Requirements
The application relies on global variables and script availability provided by the execution environment:

Dependencies: React is required for JSX processing.

Firebase: Requires global access to Firebase v11+ modules (e.g., firebase-app.js, firebase-auth.js, firebase-firestore.js).

Global Configuration:

__firebase_config: JSON configuration object for Firebase.

__initial_auth_token: Custom token for authentication.

__app_id: A unique ID for Firestore pathing.

LLM API: The Gemini API key (apiKey = "") is assumed to be provided at runtime through the environment's fetch wrapper.

Styling: Tailwind CSS is used extensively and is assumed to be loaded globally.

Running the App
To run the application, load the StudyBuddy.jsx file into a React environment that satisfies the above dependencies.

Live URL for Testing Demo:
The code provided is self-contained and ready for live execution in a compatible environment.
