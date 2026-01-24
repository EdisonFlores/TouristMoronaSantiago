import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD0ZL-HLNOYYg34Z-tC3YZYwKN8l1aoadI",
  authDomain: "touristmoronasantiago.firebaseapp.com",
  projectId: "touristmoronasantiago",
  storageBucket: "touristmoronasantiago.appspot.com",
  messagingSenderId: "271709188866",
  appId: "1:271709188866:web:7cbed805f1d8803722081b"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
