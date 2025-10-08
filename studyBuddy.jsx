import React, { useState, useEffect, useCallback, useMemo } from 'react';

// --- Global Variable Declarations (Simulated/Provided by Environment) ---
// We assume these are defined globally in the execution environment.
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'study-buddy-app';
const apiKey = ""; // API key for Gemini

// --- External Library Imports (Assuming availability via script tags/environment) ---
// Firebase
const { initializeApp } = window.firebase || {};
const { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } = window.firebaseAuth || {};
const { getFirestore, doc, collection, query, onSnapshot, setDoc } = window.firebaseFirestore || {};

// Mock NCERT Content for immediate testing (Chapter 1: Physical World)
const MOCK_NCERT_TEXT = `
Chapter 1: Physical World

1.1 What is Physics?
Physics is a basic science in the category of 'natural sciences' like Chemistry and Biology. The word 'Physics' comes from a Greek word meaning 'nature'. Physics is the study of the basic laws of nature and their manifestation in different natural phenomena. The scope of Physics is vast. It covers microscopic (atoms, nuclei) and macroscopic (terrestrial, astronomical) phenomena.

1.2 Scope and Excitement of Physics
Physics is concerned with two principal thrusts: unification and reduction. Unification is the attempt to explain diverse physical phenomena in terms of a few concepts and laws. For example, the same law of gravitation applies to a falling apple and to the motion of the moon around the earth. Reductionism is the idea of deducing the properties of a bigger, more complex system from the properties and interactions of its constituent simpler parts.

1.3 Physics, Technology and Society
The application of physics principles leads to great technological advancements. For example, the law of electromagnetism is used in radio and TV communication. Nuclear fission is used for power generation. The laser is a device based on the principle of stimulated emission of radiation. The development of steam engine led to the industrial revolution. All these advancements show the deep connection between physics, technology, and society.
`;

// --- Utility Functions for Firebase/PDF ---

// 1. Firebase Initialization and Auth
function useFirebaseSetup() {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        try {
            // Check if Firebase dependencies are available globally (as expected in this environment)
            if (!initializeApp || !getAuth || !getFirestore) {
                console.warn("Firebase dependencies not found globally. Mocking setup.");
                setUserId(crypto.randomUUID());
                setIsLoading(false);
                return;
            }

            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const authInstance = getAuth(app);
            setDb(firestore);
            setAuth(authInstance);

            const handleSignIn = async () => {
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(authInstance, initialAuthToken);
                    } else {
                        await signInAnonymously(authInstance);
                    }
                } catch (error) {
                    console.error("Firebase Auth Error, attempting anonymous fallback:", error);
                    await signInAnonymously(authInstance);
                }
            };

            const unsubscribe = onAuthStateChanged(authInstance, (user) => {
                if (user) {
                    setUserId(user.uid);
                } else {
                    handleSignIn(); // Start sign-in process
                }
                setIsLoading(false); // Authentication state is now known
            });

            return () => unsubscribe();
        } catch (e) {
            console.error("Failed to initialize Firebase:", e);
            setIsLoading(false);
            setDb(null);
            setAuth(null);
        }
    }, []);

    return { db, auth, userId, isLoading };
}

// 2. Mock/Conceptual PDF Text Extractor
// In a real browser environment, pdfjsLib (which is expected to be loaded via a script tag)
// would be used to read and parse the PDF file.
const usePdfTextExtractor = (pdfFile) => {
    const [text, setText] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!pdfFile) {
            setText('');
            return;
        }

        if (pdfFile.url === 'mock-ncert-1') {
            setText(MOCK_NCERT_TEXT);
            return;
        }

        setLoading(true);
        setText('');

        // Placeholder for complex PDF parsing logic using pdfjsLib
        // This simulates the time taken to extract text from a file.
        const mockExtraction = setTimeout(() => {
            setText(`
                --- Extracted Text from: ${pdfFile.name} ---
                This text simulates the content extracted from your uploaded PDF.
                The LLM will use this content for quiz generation and RAG answers.
                In a full implementation, the 'pdfjs-dist' library would read the
                actual content of the PDF file object provided in pdfFile.file.
            `);
            setLoading(false);
        }, 1500);

        return () => clearTimeout(mockExtraction);
    }, [pdfFile]);

    return { text, loading };
};


// 3. Firestore Hook for Progress Data
function useProgressData(db, userId) {
    const [progress, setProgress] = useState([]);

    useEffect(() => {
        if (!db || !userId || !collection || !onSnapshot || !query) return;

        const progressColRef = collection(db, `artifacts/${appId}/users/${userId}/quizzes`);
        const q = query(progressColRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const progressList = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            // Sort by latest attempt first
            progressList.sort((a, b) => b.timestamp - a.timestamp);
            setProgress(progressList);
        }, (error) => {
            console.error("Error fetching progress data: ", error);
        });

        return () => unsubscribe();
    }, [db, userId]);

    return progress;
}

// --- Gemini API Functions ---

// 1. Generate Quiz (Structured JSON Output)
async function fetchQuiz(text, quizType) {
    let systemPrompt;
    let userQuery;

    if (quizType === 'mcq') {
        systemPrompt = "You are an expert educational content generator. Based on the provided text, generate exactly 3 highly relevant and challenging Multiple Choice Questions (MCQs). Each question must have exactly 4 options and one correct answer. Respond ONLY with the JSON structure provided.";
        userQuery = "Generate a set of 3 MCQs (Multiple Choice Questions) based on the following course material text. Provide a brief, concise explanation for each correct answer.";
    } else if (quizType === 'saq') {
        systemPrompt = "You are an expert educational content generator. Based on the provided text, generate exactly 3 challenging Short Answer Questions (SAQs). Each question should require a 1-3 sentence answer. Respond ONLY with the JSON structure provided.";
        userQuery = "Generate a set of 3 SAQs (Short Answer Questions) based on the following course material text. Provide a model answer and a brief explanation for context.";
    } else { // LAQ
        systemPrompt = "You are an expert educational content generator. Based on the provided text, generate exactly 2 challenging Long Answer Questions (LAQs). Each question should require a paragraph-long answer. Respond ONLY with the JSON structure provided.";
        userQuery = "Generate a set of 2 LAQs (Long Answer Questions) based on the following course material text. Provide a model answer and a brief explanation for context.";
    }

    const payload = {
        contents: [{
            parts: [{
                text: `${userQuery}\n\nCourse Material:\n---\n${text}`
            }]
        }],
        systemInstruction: {
            parts: [{ text: systemPrompt }]
        },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    quizTitle: { type: "STRING" },
                    questions: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                id: { type: "STRING" },
                                type: { type: "STRING", enum: ['mcq', 'saq', 'laq'] },
                                question: { type: "STRING" },
                                options: {
                                    type: "ARRAY",
                                    items: { type: "STRING" }
                                },
                                correctAnswer: { type: "STRING" },
                                modelAnswer: { type: "STRING" }, // For SAQ/LAQ
                                explanation: { type: "STRING" }
                            },
                            required: ["id", "type", "question", "explanation"]
                        }
                    }
                },
                required: ["quizTitle", "questions"]
            }
        }
    };

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    for (let i = 0; i < 3; i++) { // Exponential backoff retry
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const result = await response.json();
            const textJson = result.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textJson) {
                return JSON.parse(textJson);
            }
            throw new Error("Invalid response structure from API.");

        } catch (error) {
            console.error(`Attempt ${i + 1} failed:`, error);
            if (i === 2) throw new Error("Failed to generate quiz after multiple retries.");
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        }
    }
}

// 2. Chat with RAG (Google Search for general queries, context for RAG)
async function fetchChatResponse(history, currentMessage, pdfText) {
    // Determine if Google Search or RAG is needed
    const useGoogleSearch = !pdfText || currentMessage.toLowerCase().includes('what is the latest') || currentMessage.toLowerCase().includes('recent news');
    const model = 'gemini-2.5-flash-preview-05-20';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // Simple context injection for RAG (simulated chunking for relevant text)
    const contextPart = pdfText ?
        `[CONTEXT FROM SELECTED PDF: The student is revising from this material: ${pdfText.substring(0, Math.min(pdfText.length, 2500))}...]` :
        "";

    const fullMessage = contextPart + "\n\n" + currentMessage;

    const contents = [...history, {
        role: "user",
        parts: [{ text: fullMessage }]
    }];

    const payload = {
        contents: contents,
        tools: useGoogleSearch ? [{ "google_search": {} }] : [],
        systemInstruction: {
            parts: [{ text: "You are a helpful and supportive virtual teacher. Answer questions concisely and use the provided context from the coursebook whenever possible. If you use external search (only when context is not sufficient), you must cite sources clearly. When answering based on the provided [CONTEXT], you must cite the source in your response (e.g., 'According to the text, unification is...'). Do not make up facts." }]
        }
    };

    for (let i = 0; i < 3; i++) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const result = await response.json();
            const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't generate a response.";

            let sources = [];
            const groundingMetadata = result.candidates?.[0]?.groundingMetadata;
            if (groundingMetadata && groundingMetadata.groundingAttributions) {
                sources = groundingMetadata.groundingAttributions.map(attr => ({
                    uri: attr.web?.uri,
                    title: attr.web?.title,
                })).filter(source => source.uri);
            }

            return { text, sources };

        } catch (error) {
            console.error(`Chat attempt ${i + 1} failed:`, error);
            if (i === 2) return { text: "I'm having trouble connecting right now. Please try again later.", sources: [] };
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        }
    }
}

// 3. YouTube Recommender (Uses Google Search as a proxy)
async function fetchYoutubeRecommendations(topic) {
    const model = 'gemini-2.5-flash-preview-05-20';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const userQuery = `Find 3 highly rated educational YouTube videos explaining '${topic}'. Provide the video title and the full YouTube URL. Respond ONLY with a JSON array of objects with keys 'title' and 'url'.`;

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "ARRAY",
                items: {
                    type: "OBJECT",
                    properties: {
                        title: { type: "STRING" },
                        url: { type: "STRING" }
                    },
                    required: ["title", "url"]
                }
            }
        }
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const result = await response.json();
        const textJson = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (textJson) {
            // Filter to ensure URLs are valid YouTube links
            const parsed = JSON.parse(textJson);
            return parsed.filter(item => item.url && item.url.includes('youtu'));
        }
        return [];
    } catch (error) {
        console.error("Failed to fetch YouTube recommendations:", error);
        return [];
    }
}

// --- Icons (Lucide) ---
const FileTextIcon = (props) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>;
const ZapIcon = (props) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
const TrendingUpIcon = (props) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="18 7 22 7 22 11"/></svg>;
const MessageSquareIcon = (props) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
const UploadIcon = (props) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>;
const ChevronDownIcon = (props) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>;
const ClockIcon = (props) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
const HelpCircleIcon = (props) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>;
const BookOpenIcon = (props) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>;
const SparklesIcon = (props) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 5.86l-4.14 4.08 4.08 4.14"/><path d="M14.1 18.14l4.14-4.08-4.08-4.14"/></svg>;
const VideoIcon = (props) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 7-6-4V21l6-4"/><path d="M14.7 15.3 8 19V5l6.7 3.7"/></svg>;
const UsersIcon = (props) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
const XIcon = (props) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>;

// --- Components ---

const Sidebar = ({
    pdfs,
    selectedPdf,
    onPdfSelect,
    onFileUpload,
    activeView,
    setActiveView,
    userId
}) => {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const navItems = useMemo(() => ([
        { name: 'PDF Viewer', view: 'PDF', icon: FileTextIcon },
        { name: 'Quiz Generator', view: 'QUIZ', icon: ZapIcon },
        { name: 'Virtual Teacher', view: 'CHAT', icon: MessageSquareIcon },
        { name: 'Dashboard', view: 'DASHBOARD', icon: TrendingUpIcon },
    ]), []);

    return (
        <div className="flex flex-col md:w-64 bg-gray-50 border-r border-gray-200 shadow-xl md:shadow-none h-full md:flex-shrink-0">
            {/* Header for Mobile/Desktop */}
            <div className="flex justify-between items-center p-4 border-b border-gray-200 md:block">
                <h1 className="text-2xl font-bold text-indigo-700">StudyBuddy</h1>
                <button
                    className="md:hidden p-2 rounded-lg text-gray-700 hover:bg-gray-200"
                    onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                >
                    {isMobileMenuOpen ? <XIcon className="w-6 h-6" /> : <UsersIcon className="w-6 h-6" />}
                </button>
            </div>

            {/* Content for Desktop / Open Mobile */}
            <div className={`p-4 space-y-6 flex-grow overflow-y-auto ${isMobileMenuOpen ? 'block' : 'hidden'} md:block`}>
                {/* Source Selector */}
                <div className="relative z-20">
                    <button
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        className="flex justify-between items-center w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 transition duration-150"
                    >
                        <BookOpenIcon className="w-5 h-5 mr-2 text-indigo-500" />
                        {selectedPdf ? selectedPdf.name : 'Select Coursebook'}
                        <ChevronDownIcon className={`w-4 h-4 ml-2 transition-transform ${isDropdownOpen ? 'rotate-180' : 'rotate-0'}`} />
                    </button>
                    {isDropdownOpen && (
                        <div className="absolute w-full mt-2 bg-white rounded-xl shadow-xl border border-gray-200 max-h-60 overflow-y-auto">
                            {pdfs.map((pdf) => (
                                <button
                                    key={pdf.url}
                                    onClick={() => { onPdfSelect(pdf); setIsDropdownOpen(false); }}
                                    className={`w-full text-left px-4 py-2 text-sm hover:bg-indigo-50 ${selectedPdf?.url === pdf.url ? 'bg-indigo-100 font-semibold text-indigo-700' : 'text-gray-700'}`}
                                >
                                    {pdf.name}
                                </button>
                            ))}
                            <label className="flex items-center w-full px-4 py-3 text-sm text-green-700 bg-green-50 hover:bg-green-100 cursor-pointer rounded-b-xl">
                                <UploadIcon className="w-4 h-4 mr-2" />
                                Upload PDF
                                <input
                                    type="file"
                                    accept="application/pdf"
                                    onChange={onFileUpload}
                                    className="hidden"
                                />
                            </label>
                        </div>
                    )}
                </div>

                {/* Navigation */}
                <nav className="space-y-1">
                    {navItems.map((item) => (
                        <button
                            key={item.view}
                            onClick={() => {setActiveView(item.view); setIsMobileMenuOpen(false);}}
                            className={`flex items-center w-full p-3 rounded-xl transition duration-200 ${
                                activeView === item.view
                                    ? 'bg-indigo-600 text-white shadow-lg'
                                    : 'text-gray-700 hover:bg-indigo-50 hover:text-indigo-600'
                            }`}
                        >
                            <item.icon className="w-5 h-5 mr-3" />
                            <span className="font-medium">{item.name}</span>
                        </button>
                    ))}
                </nav>

                {/* User Info (MANDATORY for multi-user apps) */}
                <div className="mt-auto pt-4 border-t border-gray-200">
                    <p className="text-xs font-semibold text-gray-600 mb-1">Authenticated User ID:</p>
                    <div className="text-xs text-gray-500 font-mono break-all p-2 bg-gray-100 rounded-lg">
                        {userId || 'Authenticating...'}
                    </div>
                </div>
            </div>
            {/* Overlay for mobile menu */}
            {isMobileMenuOpen && <div className="fixed inset-0 bg-black bg-opacity-30 z-10 md:hidden" onClick={() => setIsMobileMenuOpen(false)}></div>}
        </div>
    );
};

const QuizResultModal = ({ score, total, onClose, explanation, quizType }) => (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto transform transition-all">
            <h2 className="text-3xl font-bold text-indigo-700 mb-4 flex items-center">
                <SparklesIcon className="w-7 h-7 mr-2 text-yellow-500"/>
                Quiz Submitted!
            </h2>
            <p className="text-lg font-semibold text-gray-700 mb-4">
                You scored: <span className="text-4xl text-green-600 font-extrabold">{score} / {total}</span>
            </p>

            <div className="mt-6 p-4 bg-indigo-50 border-l-4 border-indigo-500 rounded-lg">
                <h3 className="font-bold text-lg text-indigo-800 mb-2">Detailed Feedback & Explanations</h3>
                <pre className="text-gray-700 whitespace-pre-wrap text-sm max-h-60 overflow-y-auto">{explanation}</pre>
            </div>

            <button
                onClick={onClose}
                className="mt-6 w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 transition duration-150 shadow-md"
            >
                Continue Revision
            </button>
        </div>
    </div>
);

const QuizGenerator = ({ db, userId, pdfText, pdfLoading, saveProgress }) => {
    const [quizData, setQuizData] = useState(null);
    const [currentAnswers, setCurrentAnswers] = useState({});
    const [quizLoading, setQuizLoading] = useState(false);
    const [quizType, setQuizType] = useState('mcq');
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [score, setScore] = useState(0);
    const [explanation, setExplanation] = useState('');

    const isQuizReady = !pdfLoading && pdfText && pdfText.length > 50;
    const hasQuiz = quizData?.questions?.length > 0;

    const handleGenerate = async () => {
        if (!isQuizReady) {
            console.warn("PDF text is not available or too short.");
            return;
        }

        setQuizLoading(true);
        setQuizData(null);
        setIsSubmitted(false);
        setScore(0);
        setExplanation('');

        try {
            const result = await fetchQuiz(pdfText, quizType);
            const questionsWithIds = result.questions.map(q => ({
                ...q,
                id: crypto.randomUUID(),
                userAnswer: q.type === 'mcq' ? '' : ''
            }));
            setQuizData({ ...result, questions: questionsWithIds });
            setCurrentAnswers({});
        } catch (e) {
            console.error("Quiz generation failed:", e);
            alert("Quiz generation failed. Check console for details.");
        } finally {
            setQuizLoading(false);
        }
    };

    const handleAnswerChange = (questionId, value) => {
        if (isSubmitted) return;
        setCurrentAnswers(prev => ({ ...prev, [questionId]: value }));
    };

    const handleSubmit = () => {
        if (!hasQuiz) return;

        let correctCount = 0;
        const totalQuestions = quizData.questions.length;
        let feedbackExplanation = `Quiz: ${quizData.quizTitle} (${quizType.toUpperCase()})\n\n`;

        quizData.questions.forEach((q, index) => {
            const userAnswer = currentAnswers[q.id];
            feedbackExplanation += `${index + 1}. ${q.question}\n`;

            let isCorrect = false;
            if (q.type === 'mcq') {
                isCorrect = userAnswer === q.correctAnswer;
                feedbackExplanation += `   Your Choice: ${userAnswer || 'No Answer'}\n`;
                feedbackExplanation += `   Correct Choice: ${q.correctAnswer}\n`;
            } else {
                // SAQ/LAQ scoring simulation
                isCorrect = !!userAnswer && userAnswer.length > 5; // Mark as correct if user provided a substantial answer
                feedbackExplanation += `   Your Answer: ${userAnswer ? userAnswer.substring(0, 50) + '...' : 'No Answer'}\n`;
                feedbackExplanation += `   Model Answer: ${q.modelAnswer ? q.modelAnswer.substring(0, 50) + '...' : 'N/A'}\n`;
            }

            if (isCorrect) {
                correctCount++;
                feedbackExplanation += `   Status: CORRECT\n`;
            } else {
                feedbackExplanation += `   Status: INCORRECT\n`;
            }
            feedbackExplanation += `   Explanation: ${q.explanation}\n\n`;
        });

        setScore(correctCount);
        setExplanation(feedbackExplanation);
        setIsSubmitted(true);

        // Save progress to Firestore
        saveProgress({
            type: quizType,
            score: correctCount,
            total: totalQuestions,
            timestamp: Date.now(),
            quizTitle: quizData.quizTitle
        });
    };

    // Auto-generate on load if data is ready
    useEffect(() => {
        if (isQuizReady && !hasQuiz) {
            handleGenerate();
        }
    }, [isQuizReady]);

    const renderQuestion = (q) => {
        const isMCQ = q.type === 'mcq';

        return (
            <div key={q.id} className="p-5 border border-gray-200 rounded-xl bg-white shadow-sm transition-all duration-300 hover:shadow-md">
                <p className="text-base font-semibold text-gray-800 mb-3">
                    <span className="text-indigo-600 font-extrabold mr-2">Q:</span> {q.question}
                </p>

                {isMCQ ? (
                    <div className="space-y-2">
                        {q.options.map((option, idx) => (
                            <label key={idx} className={`flex items-center p-3 rounded-lg cursor-pointer transition duration-150 ${currentAnswers[q.id] === option ? 'bg-indigo-100 ring-2 ring-indigo-500' : 'bg-gray-50 hover:bg-gray-100'}`}>
                                <input
                                    type="radio"
                                    name={`q-${q.id}`}
                                    value={option}
                                    checked={currentAnswers[q.id] === option}
                                    onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                                    className="h-4 w-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
                                    disabled={isSubmitted}
                                />
                                <span className="ml-3 text-sm font-medium text-gray-700">{option}</span>
                            </label>
                        ))}
                    </div>
                ) : (
                    <textarea
                        value={currentAnswers[q.id] || ''}
                        onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                        placeholder={`Write your ${q.type.toUpperCase()} answer here...`}
                        rows={q.type === 'saq' ? 3 : 6}
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 resize-none"
                        disabled={isSubmitted}
                    />
                )}

                {isSubmitted && (
                    <div className="mt-4 p-3 rounded-lg bg-green-50 border border-green-300">
                        <p className="text-sm font-semibold text-green-800">Model Explanation:</p>
                        <p className="text-xs text-gray-700 mt-1">{q.explanation}</p>
                    </div>
                )}
            </div>
        );
    };

    const typeOptions = [
        { value: 'mcq', label: 'MCQ (Multiple Choice)' },
        { value: 'saq', label: 'SAQ (Short Answer)' },
        { value: 'laq', label: 'LAQ (Long Answer)' },
    ];

    return (
        <div className="p-4 md:p-6 h-full overflow-y-auto">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-2">Quiz Generator Engine</h2>
            <p className="text-gray-500 mb-6">Instantly create tailored quizzes from your selected coursebook material using AI.</p>

            <div className="flex flex-col md:flex-row gap-4 mb-8 bg-white p-4 rounded-xl shadow-lg border border-indigo-100">
                <div className="flex-grow">
                    <label htmlFor="quizType" className="block text-sm font-medium text-gray-700 mb-1">Question Type</label>
                    <select
                        id="quizType"
                        value={quizType}
                        onChange={(e) => setQuizType(e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-lg bg-white focus:ring-indigo-500 focus:border-indigo-500"
                        disabled={quizLoading || !isQuizReady || isSubmitted}
                    >
                        {typeOptions.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </div>

                <div className="flex items-end">
                    <button
                        onClick={handleGenerate}
                        disabled={!isQuizReady || quizLoading}
                        className={`w-full md:w-auto px-6 py-3 rounded-xl font-semibold transition duration-300 shadow-lg flex items-center justify-center
                            ${isQuizReady && !quizLoading
                                ? 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800'
                                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                            }`}
                    >
                        <ZapIcon className="w-5 h-5 mr-2" />
                        {quizLoading ? 'Generating...' : 'Generate New Quiz'}
                    </button>
                </div>
            </div>

            {pdfLoading && (
                <div className="text-center p-12 text-indigo-500">
                    <ClockIcon className="w-8 h-8 mx-auto animate-spin" />
                    <p className="mt-2">Extracting text from PDF for AI training...</p>
                </div>
            )}

            {!isQuizReady && !pdfLoading && (
                <div className="text-center p-12 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50">
                    <HelpCircleIcon className="w-8 h-8 mx-auto text-red-500" />
                    <p className="mt-4 text-gray-600">Please select a coursebook PDF first to enable quiz generation.</p>
                </div>
            )}

            {hasQuiz && (
                <>
                    <h3 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-2">{quizData.quizTitle}</h3>
                    <div className="space-y-6">
                        {quizData.questions.map(renderQuestion)}
                    </div>
                    {!isSubmitted && (
                        <button
                            onClick={handleSubmit}
                            className="mt-8 w-full px-6 py-3 rounded-xl font-semibold text-lg transition duration-300 shadow-xl bg-green-600 text-white hover:bg-green-700 active:bg-green-800"
                        >
                            Submit Quiz
                        </button>
                    )}
                    {isSubmitted && (
                         <div className="mt-8 p-4 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 rounded-lg shadow-md">
                            Quiz submitted! Scroll up to review answers and explanations.
                            <button onClick={() => setIsSubmitted(false)} className="ml-4 font-semibold text-indigo-600 hover:text-indigo-800">Close Feedback</button>
                        </div>
                    )}
                </>
            )}

            {isSubmitted && (
                <QuizResultModal
                    score={score}
                    total={quizData.questions.length}
                    explanation={explanation}
                    quizType={quizType}
                    onClose={() => setIsSubmitted(false)}
                />
            )}
        </div>
    );
};

const ChatUI = ({ pdfText, pdfLoading }) => {
    const [chatList, setChatList] = useState([{ id: 1, name: 'Physics Revision Chat', history: [] }]);
    const [activeChatId, setActiveChatId] = useState(1);
    const [inputMessage, setInputMessage] = useState('');
    const [isTyping, setIsTyping] = useState(false);

    const activeChat = chatList.find(c => c.id === activeChatId) || chatList[0];

    const handleNewChat = () => {
        const newChat = { id: Date.now(), name: `New Chat ${chatList.length + 1}`, history: [] };
        setChatList(prev => [...prev, newChat]);
        setActiveChatId(newChat.id);
    };

    const handleSendMessage = async () => {
        if (!inputMessage.trim() || isTyping) return;

        const userMessage = { role: 'user', parts: [{ text: inputMessage }] };
        const newHistory = [...activeChat.history, userMessage];
        const currentInput = inputMessage;

        // Update local state immediately
        const updatedChatList = chatList.map(c =>
            c.id === activeChatId ? { ...c, history: newHistory } : c
        );
        setChatList(updatedChatList);
        setInputMessage('');
        setIsTyping(true);

        try {
            const { text, sources } = await fetchChatResponse(activeChat.history, currentInput, pdfText);
            const assistantMessage = { role: 'assistant', parts: [{ text: text, sources: sources }] };

            // Update with assistant's response
            setChatList(prev => prev.map(c =>
                c.id === activeChatId ? { ...c, history: [...newHistory, assistantMessage] } : c
            ));
        } catch (error) {
            const errorMessage = { role: 'assistant', parts: [{ text: "Error fetching response. Try again." }] };
            setChatList(prev => prev.map(c =>
                c.id === activeChatId ? { ...c, history: [...newHistory, errorMessage] } : c
            ));
        } finally {
            setIsTyping(false);
        }
    };

    // Auto-scroll to bottom of chat
    useEffect(() => {
        const chatWindow = document.getElementById('chat-messages');
        if (chatWindow) {
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }
    }, [activeChat.history]);

    const renderMessage = (message, index) => {
        const isUser = message.role === 'user';
        const textContent = message.parts[0].text;
        const sources = message.parts[0].sources || [];

        return (
            <div key={index} className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
                <div className={`max-w-[80%] p-4 rounded-xl shadow-md whitespace-pre-wrap ${
                    isUser
                        ? 'bg-indigo-600 text-white rounded-br-none'
                        : 'bg-white text-gray-800 rounded-tl-none border border-gray-100'
                }`}>
                    <p className="text-sm md:text-base">{textContent}</p>
                    {sources.length > 0 && (
                        <div className="mt-2 text-xs opacity-80 border-t border-gray-300 pt-2">
                            <p className="font-semibold mb-1">Sources:</p>
                            {sources.map((src, i) => (
                                <a key={i} href={src.uri} target="_blank" rel="noopener noreferrer" className="block text-blue-300 hover:underline">
                                    {src.title || new URL(src.uri).hostname}
                                </a>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="flex h-full bg-white rounded-xl shadow-lg overflow-hidden">
            {/* Left Drawer (Chat List) */}
            <div className="hidden md:flex flex-col w-64 bg-gray-50 border-r border-gray-200 p-4 space-y-4 flex-shrink-0">
                <h3 className="text-xl font-bold text-gray-800">Chats</h3>
                <button
                    onClick={handleNewChat}
                    className="w-full bg-green-500 text-white py-2 rounded-xl font-semibold hover:bg-green-600 transition duration-150 shadow-md"
                >
                    + New Chat
                </button>
                <div className="flex-grow space-y-2 overflow-y-auto">
                    {chatList.map(chat => (
                        <button
                            key={chat.id}
                            onClick={() => setActiveChatId(chat.id)}
                            className={`w-full text-left p-3 rounded-xl transition duration-150 ${chat.id === activeChatId ? 'bg-indigo-100 text-indigo-700 font-semibold border-2 border-indigo-300' : 'hover:bg-gray-100 text-gray-700'}`}
                        >
                            {chat.name}
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Chat Window */}
            <div className="flex flex-col flex-grow h-full p-4">
                <div id="chat-messages" className="flex-grow overflow-y-auto p-4 mb-4 space-y-4 bg-gray-50 rounded-xl shadow-inner border border-gray-200">
                    {activeChat.history.length === 0 && (
                        <div className="text-center p-10 text-gray-500">
                            <MessageSquareIcon className="w-8 h-8 mx-auto mb-2 text-indigo-400" />
                            <p className="font-semibold">Ask your virtual teacher anything!</p>
                            <p className="text-sm">Context is from the selected PDF.</p>
                            {pdfLoading && <p className="text-xs mt-2 text-indigo-500">Loading PDF context...</p>}
                        </div>
                    )}
                    {activeChat.history.map(renderMessage)}
                    {isTyping && (
                        <div className="flex justify-start">
                             <div className="bg-gray-200 text-gray-700 p-3 rounded-xl rounded-tl-none shadow-md">
                                <div className="dot-flashing"></div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Input Box */}
                <div className="flex items-center space-x-3">
                    <input
                        type="text"
                        value={inputMessage}
                        onChange={(e) => setInputMessage(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                        placeholder="Message StudyBuddy (e.g., 'Explain the concept of unification')"
                        className="flex-grow p-4 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 text-base"
                        disabled={isTyping}
                    />
                    <button
                        onClick={handleSendMessage}
                        disabled={!inputMessage.trim() || isTyping}
                        className={`p-4 rounded-xl transition duration-150 shadow-lg ${
                            !inputMessage.trim() || isTyping
                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                : 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800'
                        }`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 19-3-9-9-3Z"/><path d="M22 2 11 13"/></svg>
                    </button>
                </div>
            </div>
            {/* CSS for typing indicator */}
            <style jsx>{`
                .dot-flashing {
                    position: relative;
                    width: 10px;
                    height: 10px;
                    border-radius: 5px;
                    background-color: #6c63ff;
                    color: #6c63ff;
                    animation: dotFlashing 1s infinite linear alternate;
                    animation-delay: 0.5s;
                }
                .dot-flashing::before, .dot-flashing::after {
                    content: "";
                    display: inline-block;
                    position: absolute;
                    top: 0;
                }
                .dot-flashing::before {
                    left: -15px;
                    width: 10px;
                    height: 10px;
                    border-radius: 5px;
                    background-color: #6c63ff;
                    color: #6c63ff;
                    animation: dotFlashing 1s infinite alternate;
                    animation-delay: 0s;
                }
                .dot-flashing::after {
                    left: 15px;
                    width: 10px;
                    height: 10px;
                    border-radius: 5px;
                    background-color: #6c63ff;
                    color: #6c63ff;
                    animation: dotFlashing 1s infinite alternate;
                    animation-delay: 1s;
                }
                @keyframes dotFlashing {
                    0% {
                        background-color: #6c63ff;
                    }
                    50%,
                    100% {
                        background-color: #bdbbf1;
                    }
                }
            `}</style>
        </div>
    );
};

const PDFViewer = ({ pdfFile, pdfText, textLoading }) => {
    return (
        <div className="p-4 md:p-6 h-full overflow-y-auto bg-white rounded-xl shadow-lg border border-gray-200">
            <h2 className="text-2xl font-bold text-gray-800 mb-4 border-b pb-2">{pdfFile?.name || "No PDF Selected"}</h2>

            {pdfFile ? (
                <>
                    <div className="text-sm text-gray-500 mb-4 p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                        <span className="font-semibold text-indigo-600">PDF Viewer (Conceptual):</span> In a production environment, this area would render the PDF page-by-page. Here, the extracted text is shown for debug/LLM context clarity.
                    </div>
                    {textLoading ? (
                        <div className="text-center p-12 text-indigo-500">
                            <ClockIcon className="w-8 h-8 mx-auto animate-spin" />
                            <p className="mt-2">Extracting text from PDF...</p>
                        </div>
                    ) : (
                        <pre className="whitespace-pre-wrap font-mono text-sm bg-gray-50 p-4 rounded-lg border border-gray-100 max-h-[75vh] overflow-y-auto">
                            {pdfText}
                        </pre>
                    )}
                </>
            ) : (
                <div className="text-center p-12 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50">
                    <FileTextIcon className="w-10 h-10 mx-auto text-indigo-400" />
                    <p className="mt-4 text-gray-600 font-semibold">Please select or upload a PDF coursebook from the sidebar.</p>
                </div>
            )}
        </div>
    );
};

const Dashboard = ({ progressData, pdfText }) => {
    const totalAttempts = progressData.length;
    const totalQuestions = progressData.reduce((sum, attempt) => sum + attempt.total, 0);
    const totalCorrect = progressData.reduce((sum, attempt) => sum + attempt.score, 0);
    const successRate = totalQuestions > 0 ? ((totalCorrect / totalQuestions) * 100).toFixed(1) : 0;

    // Simulated weakness/strength based on the most frequent quiz type
    const quizTypeCounts = progressData.reduce((acc, attempt) => {
        acc[attempt.type] = (acc[attempt.type] || 0) + 1;
        return acc;
    }, {});

    const mostPracticedType = Object.entries(quizTypeCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || 'N/A';
    const leastPracticedType = Object.entries(quizTypeCounts).sort(([, a], [, b]) => a - b)[0]?.[0] || 'N/A';

    const [recommendations, setRecommendations] = useState([]);
    const [recoLoading, setRecoLoading] = useState(false);

    // Use the first line of the PDF text as the topic
    const topic = pdfText.substring(0, 100).split('\n')[0].replace('Chapter 1:', '').trim() || 'General Physics Revision';

    const loadRecommendations = useCallback(async () => {
        setRecoLoading(true);
        const recs = await fetchYoutubeRecommendations(topic);
        setRecommendations(recs);
        setRecoLoading(false);
    }, [topic]);

    useEffect(() => {
        if (pdfText) {
            loadRecommendations();
        } else {
            setRecommendations([]);
        }
    }, [pdfText, loadRecommendations]);

    const formatTimestamp = (ts) => {
        return new Date(ts).toLocaleString();
    };

    return (
        <div className="p-4 md:p-6 h-full overflow-y-auto space-y-8">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-2">My Revision Dashboard</h2>
            <p className="text-gray-500">Track your progress and get curated learning resources.</p>

            {/* Progress Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                <ProgressCard title="Total Quizzes" value={totalAttempts} icon={ClockIcon} color="bg-indigo-500" />
                <ProgressCard title="Total Qs Attempted" value={totalQuestions} icon={HelpCircleIcon} color="bg-green-500" />
                <ProgressCard title="Success Rate" value={`${successRate}%`} icon={TrendingUpIcon} color="bg-yellow-500" />
            </div>

            {/* Strengths & Weaknesses (Simulated) */}
            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200">
                <h3 className="text-xl font-bold text-gray-800 mb-4">Learning Insights</h3>
                <div className="flex flex-col md:flex-row gap-4">
                    <InsightCard title="Most Practiced" value={`${mostPracticedType.toUpperCase()} Quizzes`} color="bg-indigo-100" text="text-indigo-800" />
                    <InsightCard title="Needs More Practice" value={`${leastPracticedType.toUpperCase()} Quizzes`} color="bg-red-100" text="text-red-800" />
                </div>
            </div>

            {/* YouTube Recommendations */}
            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200">
                <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center">
                    <VideoIcon className="w-6 h-6 mr-2 text-red-600" />
                    Video Recommendations for: {topic}
                </h3>
                {recoLoading ? (
                    <div className="text-center p-4 text-indigo-500">
                        <ClockIcon className="w-6 h-6 mx-auto animate-spin" />
                        <p className="mt-2">Finding educational videos...</p>
                    </div>
                ) : recommendations.length > 0 ? (
                    <div className="space-y-3">
                        {recommendations.map((video, index) => (
                            <a key={index} href={video.url} target="_blank" rel="noopener noreferrer" className="flex items-center p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition duration-150 group">
                                <VideoIcon className="w-5 h-5 mr-3 text-red-500 group-hover:text-red-700 flex-shrink-0" />
                                <span className="flex-grow text-gray-700 group-hover:text-indigo-600 font-medium truncate">{video.title}</span>
                                <span className="text-sm text-indigo-500 ml-3 flex-shrink-0">Watch Now &rarr;</span>
                            </a>
                        ))}
                    </div>
                ) : (
                    <p className="text-gray-500">Could not fetch video recommendations at this time.</p>
                )}
                <button
                    onClick={loadRecommendations}
                    disabled={recoLoading || !pdfText}
                    className="mt-4 text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition duration-150"
                >
                    {recoLoading ? 'Refreshing...' : 'Refresh Recommendations'}
                </button>
            </div>

            {/* Quiz History Table */}
            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200">
                <h3 className="text-xl font-bold text-gray-800 mb-4">Quiz Attempt History</h3>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                {['Date', 'Quiz Title', 'Type', 'Score'].map(header => (
                                    <th key={header} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{header}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {progressData.map((attempt) => (
                                <tr key={attempt.id} className="hover:bg-indigo-50 transition-colors">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatTimestamp(attempt.timestamp)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">{attempt.quizTitle}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-indigo-600">{attempt.type.toUpperCase()}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                        <span className={`font-extrabold ${attempt.score > attempt.total / 2 ? 'text-green-600' : 'text-red-500'}`}>
                                            {attempt.score} / {attempt.total}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {progressData.length === 0 && (
                     <p className="text-center py-6 text-gray-500">No quiz history recorded yet. Start a quiz!</p>
                )}
            </div>
        </div>
    );
};

const ProgressCard = ({ title, value, icon: Icon, color }) => (
    <div className={`p-5 rounded-xl shadow-lg flex items-center justify-between ${color} text-white`}>
        <div>
            <p className="text-xs uppercase font-semibold opacity-80">{title}</p>
            <p className="text-3xl font-extrabold mt-1">{value}</p>
        </div>
        <Icon className="w-8 h-8 opacity-70" />
    </div>
);

const InsightCard = ({ title, value, color, text }) => (
    <div className={`flex-grow p-4 rounded-xl border-2 shadow-sm ${color} border-gray-200`}>
        <p className="text-sm font-medium text-gray-600">{title}</p>
        <p className={`text-xl font-bold mt-1 ${text}`}>{value}</p>
    </div>
);


// --- Main App Component ---

const App = () => {
    const { db, userId, isLoading: isFirebaseLoading } = useFirebaseSetup();
    const [activeView, setActiveView] = useState('PDF');
    const [pdfs, setPdfs] = useState([
        { name: 'NCERT Physics XI - Ch 1 (Mock)', url: 'mock-ncert-1', type: 'mock' },
    ]);
    const [selectedPdf, setSelectedPdf] = useState(pdfs[0]);

    // PDF Text Extraction
    const { text: pdfText, loading: textLoading } = usePdfTextExtractor(selectedPdf);

    // Progress Tracking
    const progressData = useProgressData(db, userId);

    const handlePdfSelect = (pdf) => {
        setSelectedPdf(pdf);
        setActiveView('PDF');
    };

    const handleFileUpload = (event) => {
        const file = event.target.files[0];
        if (file) {
            const newPdf = {
                name: file.name,
                url: URL.createObjectURL(file), // Use object URL for viewing
                file: file,
                type: 'user'
            };
            // Replace previous user upload with the new one
            setPdfs(prev => [...prev.filter(p => p.type !== 'user'), newPdf]);
            setSelectedPdf(newPdf);
            event.target.value = null; // Clear file input
        }
    };

    const saveProgress = async (attempt) => {
        if (!db || !userId || !collection || !setDoc) return;
        try {
            const docRef = doc(collection(db, `artifacts/${appId}/users/${userId}/quizzes`));
            await setDoc(docRef, {
                ...attempt,
                id: docRef.id
            });
            console.log("Progress saved successfully!");
        } catch (e) {
            console.error("Error saving progress: ", e);
        }
    };

    if (isFirebaseLoading) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-100">
                <div className="text-center p-8 bg-white rounded-xl shadow-xl">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-indigo-600 mx-auto"></div>
                    <p className="mt-4 text-lg font-medium text-indigo-600">Loading StudyBuddy...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col md:flex-row h-screen antialiased bg-gray-100 font-sans overflow-hidden">
            {/* Sidebar (Full height on desktop, handles its own mobile visibility) */}
            <Sidebar
                pdfs={pdfs}
                selectedPdf={selectedPdf}
                onPdfSelect={handlePdfSelect}
                onFileUpload={handleFileUpload}
                activeView={activeView}
                setActiveView={setActiveView}
                userId={userId}
            />

            {/* Main Content Area */}
            <main className="flex-grow p-4 md:p-6 overflow-hidden min-h-0">
                <div className="h-full">
                    {activeView === 'PDF' && (
                        <PDFViewer pdfFile={selectedPdf} pdfText={pdfText} textLoading={textLoading} />
                    )}
                    {activeView === 'QUIZ' && (
                        <QuizGenerator
                            db={db}
                            userId={userId}
                            pdfText={pdfText}
                            pdfLoading={textLoading}
                            saveProgress={saveProgress}
                        />
                    )}
                    {activeView === 'CHAT' && (
                        <ChatUI pdfText={pdfText} pdfLoading={textLoading} />
                    )}
                    {activeView === 'DASHBOARD' && (
                        <Dashboard progressData={progressData} pdfText={pdfText} />
                    )}
                </div>
            </main>
        </div>
    );
};

export default App;
