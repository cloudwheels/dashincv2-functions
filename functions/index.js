// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();
// trigger function on new user creation.
// when a new user is created this fucntion is triggered.
// When triggered a default
// data object is pushed to the roles collection,
// this object contains the user's role status

// import transfer function
const transfer = require("./transfer");
// const {auth} = require("firebase-admin");
exports.transfer = transfer.transfer;
exports.importUsers = transfer.importUsers;
exports.importTasks = transfer.importTasks;
exports.importBounties = transfer.importBounties;

exports.AddUserRole = functions.auth.user().onCreate(async (authUser) => {
  if (authUser.email) {
    const customClaims = {
      member: true,
    };
    try {
      await admin.auth()
          .setCustomUserClaims(authUser.uid, customClaims);
      return db.collection("roles").doc(authUser.uid).set({
        email: authUser.email,
        username: authUser.displayName,
        avatarURL: authUser.photoURL,
        role: customClaims,
      });
    } catch (error) {
      console.log(error);
    }
  }
});

// create admin user on signup
exports.setAdmin = functions.https.onCall(async (data, context) => {
  // if (!context.auth.token.admin) return
  if (!context.auth.token) return;

  try {
    await admin.auth().setCustomUserClaims(data.uid, data.role);

    return db.collection("roles").doc(data.uid).update({
      role: data.role,
    });
  } catch (error) {
    console.log("🤡", error);
  }
});
