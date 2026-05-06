const admin = require("firebase-admin");

let firebaseApp = null;

function getFirebaseMessaging() {
  if (firebaseApp) {
    return admin.messaging(firebaseApp);
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase admin credentials. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.",
    );
  }

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });

  return admin.messaging(firebaseApp);
}

module.exports = { getFirebaseMessaging };
