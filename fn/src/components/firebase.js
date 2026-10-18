// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyB0rHJ1taZP43ASOWxDw-teJw7aZENPLy8",
  authDomain: "smtpconnectonline.firebaseapp.com",
  projectId: "smtpconnectonline",
  storageBucket: "smtpconnectonline.firebasestorage.app",
  messagingSenderId: "248031116237",
  appId: "1:248031116237:web:0db0a6dc629d76d8592284",
  measurementId: "G-E3G53PQXLB"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);



export { app, auth };