import { getApps, initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBmKn1I_83LKJLALsku5f9fFwXdLCQRn-8",
  authDomain: "jimsroulette.firebaseapp.com",
  projectId: "jimsroulette",
  storageBucket: "jimsroulette.firebasestorage.app",
  messagingSenderId: "415605087090",
  appId: "1:415605087090:web:8920446e011ecb27965beb",
};

const app = getApps()[0] ?? initializeApp(firebaseConfig);

export const firebaseAuth: Auth = getAuth(app);
export const firestore: Firestore = getFirestore(app);

export async function ensureAnonymousPlayer(): Promise<string> {
  if (firebaseAuth.currentUser) return firebaseAuth.currentUser.uid;
  const credential = await signInAnonymously(firebaseAuth);
  return credential.user.uid;
}
