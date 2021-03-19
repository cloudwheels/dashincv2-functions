/* eslint-disable */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require('cors')({ origin: true });

const axios = require("axios");

const settings = {
    key: "910955be8cf85efce2eb715fea302f2b",
    board: "FPJzDcok",
    listIdConcepts: "5e5ecb480f896043ce549884",
    customFieldWorkTypeId: "5fa99f19f383211637470de0",
    customFieldWorkTypeValueProject: "5fa99f2d0115da36a487798d",
    customFieldWorkTypeValueService: "5fa99f3690b61b357f175193",
    customFieldWorkTypeValueJob: "5fa99f38cb7b3f881fd848ad",
    // customFieldSkillsId: '5fa99f541449ed8e74718a18',
    // customFieldPhaseId: '5fad5e4fea3d7956d7ddf8b2',
    // customFieldLastPhaseId: '5fad5e697fe5056ff24aa80e',
    customFieldCompletedId: "5fad5e796f461f8404c9a8ed",
    customFieldSourceId: "5fad5ed8bd4d6a70d106cee4",
    customFieldWebsiteId: "5fad5ef4ad9d647d24825bcd",
    customFieldMetaId: "5fad5f1b8db2260cdda1ffed",
    customFieldPausedId: "5fad5f8741fe01397d1fa66b",
    customFieldRatingId: "5fae86fd692d080b43dd737",
    customFieldSecondaryAdminId: "5ff85abd2b962872d01fe3bf",
};

const apiMembers = `https://api.trello.com/1/board/${settings.board}/members?key=${settings.key}&fields=id,username,fullName,avatarHash,avatarUrl,initials,memberType`;
// https://api.trello.com/1/board/FPJzDcok/members?key=910955be8cf85efce2eb715fea302f2b&fields=id,username,fullName,avatarHash,avatarUrl,initials,memberType
const apiCards = `https://api.trello.com/1/board/${settings.board}/cards?checklists=all&fields=id,name,idList,shortUrl,desc&customFieldItems=true&members=true&member_fields=username&key=${settings.key}`;
//to retireve avatar, add /50.png to url (for 50px avatar)

const db = admin.firestore();




exports.transfer = functions
    .https.onRequest(async (req, res) => {
        res.set('Access-Control-Allow-Origin', '*');



        try {
            // delete all exiting users

            const allUsers = await admin.auth().listUsers();
            console.log("allUSers", allUsers);
            const allUsersUID = allUsers.users.map((user) => user.uid);
            await admin.auth().deleteUsers(allUsersUID);
            console.log("deleted existing users");


            // delete all firestore collections

            // delete the roles collection
            console.log("deleting roles");
            await deleteCollection(db, "roles", 100);
            console.log("deleted roles");

            // delete the bounty cards collection
            console.log("deleting bounty-cards");
            await deleteCollection(db, "bounty-cards", 100);
            console.log("deleted bounty-cards");

            // delete the tasks collection
            console.log("deleting tasks");
            await deleteCollection(db, "tasks", 100);
            console.log("deleted tasks");

            // fetch users from trello & create in firebase

            const reqMembers = await axios.get(apiMembers);
            const members = reqMembers.data;
            console.log(`retrieved member data: ${JSON.stringify(members)}`);

            members.forEach(async (m) => {
                console.log("creating user");
                const userRecord = await admin
                    .auth()
                    .createUser({
                        uid: m.id,
                        email: `${m.username}@dashincubator.app`,
                        displayName: m.username,
                        photoURL: `${m.avatarUrl}/50.png`
                    });
                console.log("Successfully created new user:", userRecord.uid);
            });

            // TODO - Add usernames to profile

            // TODO - Update Admin Roles

            // fetch and process trello bounty data

            const reqCards = await axios.get(apiCards);
            const allCards = reqCards.data;
            //console.log(`retrieved card data: ${JSON.stringify(allCards)}`);

            // ignore Concepts for now
            const cardsToProcess = allCards.filter((item) =>
                item.idList !== settings.listIdConcepts);

            // remove cards with no checkklist?? -shouldn't be necessary

            // proceess card level data
            cardsToProcess.map(async (c) => {
                const card = {};
                card.trelloId = c.id;
                card.title = c.name;
                card.description = c.desc;

                //get custom fields
                let cardCustomFields = processCustomFields(c.customFieldItems);
                card.workType = cardCustomFields.workType || null;
                card.rating = cardCustomFields.rating;
                card.source = cardCustomFields.source;
                card.website = cardCustomFields.website;
                card.completed = cardCustomFields.completed;
                card.paused = cardCustomFields.paused;
                card.meta = cardCustomFields.meta

                console.log("got custom fields")

                //get admins
                let cardAdmins = c.members;
                console.log("cardAdmins", cardAdmins)
                if (cardAdmins.length == 1) {
                    card.adminPrimary = cardAdmins[0].id
                    card.adminSecondary = null;
                }
                else if (cardAdmins.length == 2) {
                    // TODO: map secondry admin username 
                    // to find primary & secondary

                    card.adminPrimary = cardAdmins[0].id
                    card.adminSecondary = null;
                }
                else {
                    card.adminPrimary = null;
                    card.adminSecondary = null;
                }


                // process tasks
                card.tasks = [];

                //collect tasks errors
                let taskWarnings = [];

                console.log("processing tasks")

                await Promise.all(c.checklists.map(async checklist => {
                    let ignoreBadTaskListName;
                    let checklistName = checklist.name;
                    //let taskType = checklist.name.split(" ")[0].toUpperCase()
                    //We don't need Concept Tasks
                    if (checklistName != 'Production Tasks' &&
                        checklistName != 'Specification Tasks' &&
                        checklistName != 'QA Tasks') {
                        ignoreBadTaskListName = true;

                    }
                    await Promise.all(checklist.checkItems.map(async checklistItem => {
                        let task = {};
                        let taskFatalErrors;

                        let taskId = checklistItem.id;
                        let checklistItemName = checklistItem.name;

                        if (ignoreBadTaskListName) {
                            taskWarnings.push({ warnLevel: 1, warningText: `Has bad checklist item name (${checklistName}) - Not processed`, cardName: card.name, cardUrl: card.shortUrl, taskDesc: checklistItemName });
                            taskFatalErrors = true;

                        }



                        let parsedDesc = splitTaskDescription(checklistItemName);
                        //console.log("PARSED DESC", parsedDesc)

                        //console.log('parsedDesc', parsedDesc);
                        task.number = parsedDesc.taskNumber;
                        if (task.number == null) {
                            taskWarnings.push({ warnLevel: 1, warningText: `Task Number did not parse (${checklistName}) - Not processed`, cardName: c.name, cardUrl: c.shortUrl, taskDesc: checklistItemName });
                            taskFatalErrors = true;

                        }
                        task.description = parsedDesc.taskDesc
                        if (task.description == null) {
                            taskWarnings.push({ warnLevel: 1, warningText: `Task Description did not parse (${checklistName}) - Not processed`, cardName: c.name, cardUrl: c.shortUrl, taskDesc: checklistItemName });
                            taskFatalErrors = true;

                        }


                        if (parsedDesc.rewardDash == null) {
                            taskWarnings.push({ warnLevel: 1, warningText: `Task Amount did not parse (${checklistName}) - Not processed`, cardName: c.name, cardUrl: c.shortUrl, taskDesc: checklistItemName });
                            taskFatalErrors = true;

                        }
                        else {
                            task.rewardDash = rewardDash.toFixed(2)
                        }


                        task.due = checklistItem.due || null;


                        //assigned member
                        task.assignedMemberId = checklistItem.idMember || null;


                        //write the task
                        // TODO write to correct task type
                        let taskWriteResult =
                            await admin.firestore().collection("tasks").doc(checklistItem.id).set(task);
                        // Send back a message that we've successfully written the message
                        ///console.log("taskWriteResult", taskWriteResult);
                        //console.log({ result: `Task with ID: ${taskWriteResult.id} added.` });

                        //if (taskFatalErrors) { return; }
                        //TODO: make a reference type 

                        taskDoc = db.doc(`/tasks/${taskId}`)
                        //console.log("TASK DOC", taskDoc)
                        card.tasks.push(taskDoc)
                        console.log("CARD TASKS:", card.tasks.length)




                    }))


                }))



                //console.log("CARD TASKS:", card.tasks)

                //console.log("task warnings", taskWarnings)


                console.log(`adding bounty-card`);
                console.log("CARD TASKS LENGTH:", card.tasks.length)
                //console.dir(card)
                let docwWriteResult =
                    await admin.firestore().collection("bounty-cards").doc(c.id).set(card);
                // Send back a message that we've successfully written the message
                //console.log({ result: `Bounty card with ID: ${docwWriteResult.id} added.` });
            });


            // TODO: get comments/history

            return res.status(200).json(
                { success: true },
            );
        } catch (e) {
            return res.status(500).json({
                error: e,
            });
        }

    });



    exports.importUsers = functions
    .https.onRequest(async (req, res) => {
        res.set('Access-Control-Allow-Origin', '*');
        try {
            // delete all exiting users

            const allUsers = await admin.auth().listUsers();
            console.log("allUSers", allUsers);
            const allUsersUID = allUsers.users.map((user) => user.uid);
            await admin.auth().deleteUsers(allUsersUID);
            console.log("deleted existing users");

            // delete the roles collection
            console.log("deleting roles");
            await deleteCollection(db, "roles", 100);
            console.log("deleted roles");

            // fetch users from trello & create in firebase

            const reqMembers = await axios.get(apiMembers);
            const members = reqMembers.data;
            console.log(`retrieved member data: ${JSON.stringify(members)}`);

            await Promise.all(members.forEach(async (m) => {
                console.log("creating user");
                const userRecord = await admin
                    .auth()
                    .createUser({
                        uid: m.id,
                        email: `${m.username}@dashincubator.app`,
                        password: 'password',
                        displayName: m.username,
                        photoURL: `${m.avatarUrl}/50.png`
                    });
                console.log("Successfully created new user:", userRecord.uid);
            }));

            return res.status(200).json(
                { success: true },
            );
        } catch (e) {
            return res.status(500).json({
                error: e,
            });
        }

    });


async function deleteCollection(db, collectionPath, batchSize) {
    /** delete firestore collection */
    const collectionRef = db.collection(collectionPath);
    const query = collectionRef.orderBy("__name__").limit(batchSize);

    return new Promise((resolve, reject) => {
        deleteQueryBatch(db, query, resolve).catch(reject);
    });
}

async function deleteQueryBatch(db, query, resolve) {
    /** delete query batch */
    const snapshot = await query.get();

    const batchSize = snapshot.size;
    if (batchSize === 0) {
        // When there are no documents left, we are done
        resolve();
        return;
    }

    // Delete documents in a batch
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });
    await batch.commit();

    // Recurse on the next process tick, to avoid
    // exploding the stack.
    process.nextTick(() => {
        deleteQueryBatch(db, query, resolve);
    });
}

// [END delete_collection]


// TRello card procesing

function processCustomFields(arrCustomFields) {
    /** accepts an array of custom fields from card data
          *  returns an object containing Work Type & Skills
          *  global constants for custom fields
          * TODO - get a more effecient way to do this..!
          */

    const customFields = {};

    // get cardWorkType
    arrCustomFields.filter((field) => field.idCustomField == settings.customFieldWorkTypeId)
        .map((value) => {
            switch (value.idValue) {
                case settings.customFieldWorkTypeValueProject:
                    customFields.workType = "Project";
                    break;
                case settings.customFieldWorkTypeValueService:
                    customFields.workType = "Service";
                    break;
                case settings.customFieldWorkTypeValueJob:
                    customFields.workType = "Job";
                    break;
                default: customFields.workType = null;
            }
        });

    /*
          DEPRECATED CUSTOM FIELDS:
  
              //get Skills
              filterSkills = arrCustomFields.filter(field => field.idCustomField == TRELLO_CUSTOM_ID_SKILLS)
              if (filterSkills.length > 0) {
                  filterSkills.map(value => {
                      customFields.skills = value.value.text;
                  });
              }
              else {
                  customFields.skills = null;
              }
  
              //get Phase
              filterPhase = arrCustomFields.filter(field => field.idCustomField == TRELLO_CUSTOM_ID_PHASE)
              if (filterPhase.length > 0) {
                  filterPhase.map(value => {
                      customFields.phase = value.value.number;
                  });
              }
              else {
                  customFields.phase = null;
              }
  
              //get Last Phase
              filterLastPhase = arrCustomFields.filter(field => field.idCustomField == TRELLO_CUSTOM_ID_LAST_PHASE)
              if (filterLastPhase.length > 0) {
                  filterLastPhase.map(value => {
                      customFields.lastPhase = value.value.number;
                  });
              }
              else {
                  customFields.lastPhase = null;
              }
          */


    // get Rating
    const filterRating = arrCustomFields.filter((field) => field.idCustomField == settings.customFieldRatingId);
    if (filterRating.length > 0) {
        filterRating.map((value) => {
            customFields.rating = parseFloat(value.value.number);
        });
    } else {
        customFields.rating = 0;
    }

    // get Source
    const filterSource = arrCustomFields.filter((field) => field.idCustomField == settings.customFieldSourceId);
    if (filterSource.length > 0) {
        filterSource.map((value) => {
            customFields.source = value.value.text;
        });
    } else {
        customFields.source = null;
    }

    // get Website
    const filterWebsite = arrCustomFields.filter((field) => field.idCustomField == settings.customFieldSourceId);
    if (filterWebsite.length > 0) {
        filterWebsite.map((value) => {
            customFields.website = value.value.text;
        });
    } else {
        customFields.website = null;
    }

    // get Completed
    const filterCompleted = arrCustomFields.filter((field) => field.idCustomField == settings.customFieldCompletedId);
    if (filterCompleted.length > 0) {
        filterCompleted.map((value) => {
            console.log("BOUNTy COMPLETE?", value.value.checked);
            customFields.completed = value.value.checked == "true";
        });
    } else {
        customFields.completed = false;
    }

    // get Paused
    const filterPaused = arrCustomFields.filter((field) => field.idCustomField == settings.customFieldPausedId);
    if (filterPaused.length > 0) {
        filterPaused.map((value) => {
            customFields.paused = value.value.checked == "true";
        });
    } else {
        customFields.paused = false;
    }

    // get Meta
    const filterMeta = arrCustomFields.filter((field) => field.idCustomField == settings.customFieldMetaId);
    if (filterMeta.length > 0) {
        filterMeta.map((value) => {
            customFields.meta = value.value.checked == "true";
        });
    } else {
        customFields.meta = false;
    }

    //get SecondaryAdmin
    filterSecondaryAdmin = arrCustomFields.filter(field => field.idCustomField == settings.customFieldSecondaryAdminId)
    if (filterSecondaryAdmin.length > 0) {
        filterSecondaryAdmin.map(value => {
            customFields.secondaryAdmin = value.value.text;
        });
    }
    else {
        customFields.secondaryAdmin = null;
    }

    return customFields;
}

function splitTaskDescription(strTaskDescription) {
    /** Splits task description into data */
    try {
        const firstRBracket = strTaskDescription.indexOf(")");

        // task number
        let taskNumber = null;

        const parseTaskNum = strTaskDescription.substr(0, firstRBracket);

        // if ($.isNumeric(parseTaskNum)) {
        taskNumber = parseTaskNum;
        // }


        // extracts Dash Reward amount from task description
        // get last parenthesised text
        const lastLBracket = strTaskDescription.lastIndexOf("(");
        // console.log('lastLBracket',lastLBracket);
        const lastRBracket = strTaskDescription.lastIndexOf(")");
        // console.log('lastRBracket',lastRBracket);


        const taskDesc = strTaskDescription.substr(firstRBracket + 1, lastLBracket - firstRBracket - 1).trim();

        /*
    
                    //replace md links with html <a> link
                    let elements = taskDesc.match(/\[.*?\)/g);
                    if (elements != null && elements.length > 0) {
                        for (el of elements) {
                            let txt = el.match(/\[(.*?)\]/)[1];//get only the txt
                            let url = el.match(/\((.*?)\)/)[1];//get only the link
                            taskDesc = taskDesc.replace(el, '<a href="' + url + '" target="_blank">' + txt + '</a>')
                        }
                    }
    
                    */

        const lastBracketContent = strTaskDescription.substr(lastLBracket + 1, lastRBracket - lastLBracket - 1).trim().toUpperCase();
        // console.log('lastBracketContent',lastBracketContent);
        const posOfTextDash = lastBracketContent.indexOf("DASH");
        // console.log('posOfTextDash',posOfTextDash);
        const amountStr = lastBracketContent.substr(0, posOfTextDash).trim();
        // console.log('amountStr',amountStr);
        // TODO: $.isNumeric is DEPRECATED!
        // replace with pure JS implementation
        let amt = null;
        // if ($.isNumeric(amountStr)) {
        amt = parseFloat(amountStr);
        // }
        return { taskNumber: taskNumber, taskDesc: taskDesc, taskRewardDash: amt };
    } catch (e) {
        console.log(e);
        // throw e
        return { taskNumber: null, taskDesc: null, rewardDash: null };
    }
}
