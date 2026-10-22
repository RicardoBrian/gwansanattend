import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/**
 * Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹) 의 firebaseConfig 를 그대로 붙여 넣는다.
 * 이 값은 공개되어도 되는 식별자다 — 실제 보호는 firestore.rules 가 한다.
 * 비어 있으면 앱이 "Firebase 설정이 필요합니다" 화면을 띄운다.
 */
const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// 로컬(localhost)에서는 에뮬레이터에 붙는다. 설정값이 비어 있어도 demo 프로젝트로 돈다.
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

export const CONFIGURED = !!firebaseConfig.apiKey || LOCAL;

const app = CONFIGURED
  ? initializeApp(firebaseConfig.apiKey ? firebaseConfig : { apiKey: 'demo', projectId: 'demo-gwansanattend', authDomain: 'localhost' })
  : null;
export const db = app && getFirestore(app);
export const auth = app && getAuth(app);

if (app && LOCAL) {
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
}
