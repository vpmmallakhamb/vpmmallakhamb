import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, addDoc, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyCau06VyhnUSHRIq-gyuQ9dw42IvSG9Nuw",
    authDomain: "vpmmallakhamb-a97b3.firebaseapp.com",
    projectId: "vpmmallakhamb-a97b3",
    storageBucket: "vpmmallakhamb-a97b3.firebasestorage.app",
    messagingSenderId: "249071680936",
    appId: "1:249071680936:web:9bb62d8bfbc4b3b71e719d"
};

// ✅ INTEGRATED GOOGLE SHEETS WEB APP URL:
const GOOGLE_SHEETS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzkQlzRqQaX0YEcbRFBV3Ik549dZ1Z1RBBp3xeVCfnrhAO4oelf9nHtIvhatLR-RKJ9/exec";
const GOOGLE_CALENDAR_APP_SCRIPT_URL = "YOUR_CALENDAR_SCRIPT_URL_HERE"; 
const GOOGLE_CALENDAR_ID = "YOUR_CALENDAR_ID_HERE@group.calendar.google.com";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app); 
const provider = new GoogleAuthProvider();

const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userInfo = document.getElementById('userInfo');
const userName = document.getElementById('userName');

let CURRENT_USER_ROLE = 'guest'; 
const quill = new Quill('#blogEditor', { theme: 'snow', modules: { toolbar: '#quill-toolbar' }, placeholder: 'Draft article content...' });

document.getElementById('homeLogo').addEventListener('click', () => { showSection('guest-section'); });
const generateVPMId = () => 'VPM-' + Math.random().toString(36).substr(2, 6).toUpperCase();

// --- MASTER EVENT DELEGATION: SECURED ---
document.body.addEventListener('click', async (e) => {
    // 1. Edit Buttons
    if (e.target.classList.contains('edit-player-btn')) {
        openEditModal(e.target.dataset.docid);
    }
    
    // 2. Delete Buttons (STRICT ADMIN LOCK)
    if (e.target.classList.contains('delete-doc-btn')) {
        if (CURRENT_USER_ROLE !== 'admin') {
            alert("🔒 Permission Denied: Only System Administrators can delete records.");
            return;
        }

        if (!confirm("WARNING: Are you sure you want to permanently delete this?")) return;
        const colName = e.target.dataset.col;
        const docId = e.target.dataset.id;
        
        try {
            await deleteDoc(doc(db, colName, docId));
            e.target.closest('.deletable-item').remove(); 
            alert("Deleted successfully.");
        } catch (error) {
            console.error(error); alert("Failed to delete.");
        }
    }
    
    // 3. Close Modals
    if (e.target.classList.contains('close-btn')) {
        e.target.closest('.modal-overlay').classList.add('hidden');
    }
});

document.body.addEventListener('change', async (e) => {
    if (e.target.classList.contains('update-hof-photo-input')) {
        const file = e.target.files[0];
        if (!file) return;
        const docId = e.target.dataset.id;
        const label = e.target.parentElement;
        const textNode = label.firstChild;
        const originalText = textNode.textContent;
        textNode.textContent = "Uploading...";
        e.target.disabled = true;
        try {
            const photoUrl = await uploadImageToStorage(file, 'hof_photos');
            await updateDoc(doc(db, "HallOfFame", docId), { photoUrl: photoUrl });
            alert("Photo updated successfully!");
            loadGuestFeeds(); 
        } catch (err) {
            console.error(err);
            alert("Failed to upload photo.");
        } finally {
            textNode.textContent = originalText;
            e.target.disabled = false;
        }
    }
});

// --- GOOGLE API FETCHERS ---
async function pushToGoogleSheet(dataPayload) {
    if(!GOOGLE_SHEETS_WEB_APP_URL || GOOGLE_SHEETS_WEB_APP_URL === "YOUR_SHEETS_SCRIPT_URL_HERE") return; 
    try { await fetch(GOOGLE_SHEETS_WEB_APP_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(dataPayload) }); } 
    catch(e) { console.error(e); }
}

async function fetchGoogleCalendarEvents() {
    if(GOOGLE_CALENDAR_APP_SCRIPT_URL === "YOUR_CALENDAR_SCRIPT_URL_HERE") return [];
    try {
        const res = await fetch(`${GOOGLE_CALENDAR_APP_SCRIPT_URL}?calId=${encodeURIComponent(GOOGLE_CALENDAR_ID)}`);
        return await res.json();
    } catch(e) { console.error(e); return []; }
}

document.getElementById('syncSheetsBtn').addEventListener('click', async () => {
    const btn = document.getElementById('syncSheetsBtn'); btn.textContent = "Syncing..."; btn.disabled = true;
    try {
        alert("Pushing data will overwrite the Google Sheet with the current Website Database. If you made changes in the Sheet, click 'Pull from Sheets' first!");
        const snapshot = await getDocs(query(collection(db, "Users"), where("role", "==", "player")));
        let allPlayers = []; 
        snapshot.forEach(doc => { let data = doc.data(); if(!data.vpmId) { data.vpmId = generateVPMId(); updateDoc(doc.ref, { vpmId: data.vpmId }); } allPlayers.push(data); });
        await pushToGoogleSheet(allPlayers); alert("Success! Database has been pushed to Google Sheets.");
    } catch (e) { console.error(e); alert("Error syncing to Sheets."); } finally { btn.textContent = "1. Push to Sheets"; btn.disabled = false; }
});

document.getElementById('pullFromSheetsBtn').addEventListener('click', async () => {
    const btn = document.getElementById('pullFromSheetsBtn'); btn.textContent = "Pulling..."; btn.disabled = true;
    try {
        const response = await fetch(GOOGLE_SHEETS_WEB_APP_URL); const sheetPlayers = await response.json();
        let addedCount = 0; let updatedCount = 0;
        for (let player of sheetPlayers) {
            if (player.vpmId) {
                const q = query(collection(db, "Users"), where("vpmId", "==", player.vpmId)); const snap = await getDocs(q);
                if (!snap.empty) { await updateDoc(doc(db, "Users", snap.docs[0].id), player); updatedCount++; }
                else { if(!player.dateJoined) player.dateJoined = new Date().toISOString().split('T')[0]; if(!player.careerStatus) player.careerStatus = "Playing"; await addDoc(collection(db, "Users"), player); addedCount++; }
            } else {
                player.vpmId = generateVPMId(); if(!player.dateJoined) player.dateJoined = new Date().toISOString().split('T')[0]; if(!player.careerStatus) player.careerStatus = "Playing"; await addDoc(collection(db, "Users"), player); addedCount++;
            }
        }
        alert(`Success! Pulled ${addedCount} new players and updated ${updatedCount} existing records. Triggering automatic push to update IDs in sheet...`); 
        document.getElementById('syncSheetsBtn').click(); loadAdminDashboard(); loadCoachDashboard(); populatePlayerDropdowns(); 
    } catch (error) { console.error(error); alert("Error pulling from Sheets."); } finally { btn.textContent = "2. Pull from Sheets"; btn.disabled = false; }
});

async function compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.8) {
    return new Promise((resolve, reject) => {
        try {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = event => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    try {
                        let width = img.width; let height = img.height;
                        if (width > height) { if (width > maxWidth) { height = Math.round(height * (maxWidth / width)); width = maxWidth; } } 
                        else { if (height > maxHeight) { width = Math.round(width * (maxHeight / height)); height = maxHeight; } }
                        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
                        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height);
                        canvas.toBlob(blob => {
                            try {
                                if(blob) {
                                    const baseName = file.name ? file.name.replace(/\.[^/.]+$/, "") : "image";
                                    blob.name = baseName + ".jpg";
                                    resolve(blob);
                                }
                                else reject(new Error('Compression failed'));
                            } catch(e) { reject(e); }
                        }, 'image/jpeg', quality);
                    } catch(err) { reject(err); }
                };
                img.onerror = error => reject(error);
            };
            reader.onerror = error => reject(error);
        } catch(err) { reject(err); }
    });
}

async function uploadImageToStorage(file, folderPath) {
    if (!file) return null; 
    
    const uploadWithTimeout = (storageRef, fileObj, timeoutMs = 15000) => {
        return Promise.race([
            uploadBytes(storageRef, fileObj),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Firebase Storage Upload Timeout. Check your Storage Rules and bucket config!")), timeoutMs))
        ]);
    };

    try {
        const processedFile = file.type.startsWith('image/') ? await compressImage(file) : file;
        const uniqueFileName = `${Date.now()}_${processedFile.name || 'image.jpg'}`; 
        const storageRef = ref(storage, `${folderPath}/${uniqueFileName}`);
        await uploadWithTimeout(storageRef, processedFile); 
        return await getDownloadURL(storageRef); 
    } catch(e) {
        console.warn("Compression/Upload failed, trying fallback:", e);
        if (e.message.includes("Timeout")) throw e; // Don't fallback if it's a network/config timeout
        const uniqueFileName = `${Date.now()}_${file.name || 'image.jpg'}`; const storageRef = ref(storage, `${folderPath}/${uniqueFileName}`);
        await uploadWithTimeout(storageRef, file); return await getDownloadURL(storageRef);
    }
}

function generateGoogleCalLink(dateStr, startStr, endStr, groupName) {
    const formatDt = (dtStr, tStr) => new Date(`${dtStr}T${tStr}`).toISOString().replace(/-|:|\.\d+/g, '');
    const title = encodeURIComponent(`VPM Practice (${groupName})`); const details = encodeURIComponent(`Official VPM Dahisar Training Session for ${groupName} Tier.`);
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${formatDt(dateStr, startStr)}/${formatDt(dateStr, endStr)}&details=${details}`;
}

// VISUAL CALENDAR GENERATOR
async function buildCalendar(elementId, filterGroup = null, filterGender = null) {
    const calEl = document.getElementById(elementId);
    if (!calEl) return;
    calEl.innerHTML = "<p>Loading calendar...</p>"; 

    try {
        let eventsArr = [];
        const snap = await getDocs(collection(db, "Schedules"));
        
        snap.forEach(doc => {
            let d = doc.data();
            if ((!filterGroup || d.group === "All" || d.group === filterGroup) && (!filterGender || d.gender === "All" || d.gender === filterGender)) {
                eventsArr.push({ id: doc.id, title: `${d.group} Practice`, start: `${d.date}T${d.startTime}`, end: `${d.date}T${d.endTime}`, extendedProps: { docId: doc.id, gender: d.gender } });
            }
        });

        calEl.innerHTML = ""; 
        let calendar = new FullCalendar.Calendar(calEl, {
            initialView: 'dayGridMonth',
            headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' },
            events: eventsArr, height: 500,
            eventClick: function(info) {
                if (CURRENT_USER_ROLE === 'admin') {
                    if(confirm(`Do you want to permanently delete the session: "${info.event.title}" on ${info.event.start.toLocaleDateString()}?`)) {
                        deleteDoc(doc(db, "Schedules", info.event.extendedProps.docId)); info.event.remove();
                    }
                } else {
                    alert(`Session: ${info.event.title}\nTime: ${info.event.start.toLocaleTimeString()} to ${info.event.end ? info.event.end.toLocaleTimeString() : 'N/A'}`);
                }
            }
        });
        calendar.render();
    } catch(e) { console.error(e); calEl.innerHTML = "<p>Error loading calendar.</p>"; }
}

loadGuestFeeds();

loginBtn.addEventListener('click', async () => { try { await signInWithPopup(auth, provider); } catch (error) { console.error("Login error:", error); } });
logoutBtn.addEventListener('click', async () => { try { await signOut(auth); } catch (error) { console.error("Logout error:", error); } });

onAuthStateChanged(auth, async (user) => {
    if (user) {
        loginBtn.classList.add('hidden'); userInfo.classList.remove('hidden'); userName.textContent = user.displayName.toUpperCase();
        document.querySelectorAll('.buy-merch-btn').forEach(btn => { btn.textContent = "PURCHASE ITEM"; btn.dataset.loggedIn = "true"; });

        try {
            const usersRef = collection(db, "Users"); const q = query(usersRef, where("email", "==", user.email)); const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
                let userData = querySnapshot.docs[0].data(); let userRole = userData.role; let docId = querySnapshot.docs[0].id;
                CURRENT_USER_ROLE = userRole; 
                
                if(CURRENT_USER_ROLE === 'admin') loadGuestFeeds(); // Reloads to inject delete buttons

                if (userRole === "admin") { showSection('admin-section'); loadAdminDashboard(); populatePlayerDropdowns(); } 
                else if (userRole === "coach" || userRole === "fees_manager") {
                    showSection('coach-section'); loadCoachDashboard();
                    if (userRole === "fees_manager") { document.getElementById('coachFeesCard').classList.remove('hidden'); populatePlayerDropdowns(); loadRecentFees('coachRecentFeesList'); } 
                    else { document.getElementById('coachFeesCard').classList.add('hidden'); }
                } else if (userRole === "player") { showSection('player-section'); loadPlayerDashboard(userData, docId); } 
                else { showSection('guest-section'); }
            } else {
                try { await addDoc(collection(db, "Users"), { email: user.email, name: user.displayName || "Website Guest", role: "guest" }); } catch(e) { console.error(e); }
                showSection('guest-section');
            }
        } catch (error) { console.error(error); showSection('guest-section'); }
    } else {
        CURRENT_USER_ROLE = 'guest';
        loginBtn.classList.remove('hidden'); userInfo.classList.add('hidden'); userName.textContent = "";
        document.querySelectorAll('.buy-merch-btn').forEach(btn => { btn.textContent = "LOGIN TO PURCHASE"; btn.dataset.loggedIn = "false"; });
        showSection('guest-section');
    }
});

function showSection(sectionId) { document.querySelectorAll('.role-section').forEach(section => { section.classList.remove('active'); }); if(sectionId !== 'guest-section') { document.getElementById('guest-section').classList.remove('active'); } document.getElementById(sectionId).classList.add('active'); }
window.showSection = showSection;

window.openHofModal = async function(playerData) {
    const modal = document.getElementById('hofModal'); const img = document.getElementById('hofModalImage'); const nameLabel = document.getElementById('hofModalName'); const achContainer = document.getElementById('hofModalAchievements');
    img.src = playerData.photoUrl || 'https://via.placeholder.com/120'; nameLabel.textContent = `${playerData.firstName} ${playerData.lastName}`;
    achContainer.innerHTML = '<p class="loading-text">Fetching achievements...</p>'; 
    modal.classList.remove('hidden');
    try {
        const achSnap = await getDocs(query(collection(db, "Achievements"), where("playerId", "==", playerData.playerId))); achContainer.innerHTML = "";
        if (achSnap.empty) { achContainer.innerHTML = '<p class="text-muted">No tournament achievements logged yet.</p>'; } 
        else {
            achSnap.forEach(docSnap => {
                const data = docSnap.data(); let medalsHTML = data.medals ? data.medals.map(m => `<span class="medal-badge">${m.medal || m.type} | ${m.eventType} ${m.eventType === 'Apparatus Championship' && m.apparatus ? '- ' + m.apparatus : ''} (${m.level})</span>`).join('') : ''; 
                achContainer.innerHTML += `<div class="blog-card" style="padding:20px;"><div class="cms-meta"><span class="cms-tag">${data.date}</span></div><h4 style="color:var(--brand-primary);margin-bottom:10px;font-size:18px;">${data.title}</h4><p style="color:var(--text-muted);font-size:14px;margin-bottom:15px;">${data.description}</p><div style="margin: 15px 0;">${medalsHTML}</div></div>`;
            });
        }
    } catch (error) { console.error(error); achContainer.innerHTML = '<p class="text-muted">Failed to load achievements.</p>'; }
}

async function loadAdminHofList() {
    const adminHofList = document.getElementById('adminHofList'); if (!adminHofList) return;
    try {
        const snapshot = await getDocs(collection(db, "HallOfFame")); adminHofList.innerHTML = "";
        snapshot.forEach(docSnap => {
            let data = docSnap.data();
            adminHofList.innerHTML += `<li class="deletable-item" style="display:flex; justify-content:space-between; align-items:center;"><div><strong>${data.firstName} ${data.lastName}</strong></div> <div style="display:flex; gap:10px; align-items:center;"><label class="action-link" style="cursor:pointer; margin:0; font-size:12px;">Upload Photo<input type="file" class="update-hof-photo-input" data-id="${docSnap.id}" accept="image/*" style="display:none;"></label> <button class="delete-doc-btn" data-col="HallOfFame" data-id="${docSnap.id}" style="margin:0;">Remove</button></div></li>`;
        });
    } catch (error) { console.error(error); }
}

document.addEventListener('DOMContentLoaded', () => {
    const hofForm = document.getElementById('adminHallOfFameForm');
    if (hofForm) {
        hofForm.addEventListener('submit', async (e) => {
            e.preventDefault(); const val = document.getElementById('adminHofPlayer').value; if (!val) return alert("Select an athlete");
            const parts = val.split('|'); const playerId = parts[0]; const fullName = parts[1]; const photoUrl = parts[2] || '';
            const nameParts = fullName.split(' '); const firstName = nameParts[0]; const lastName = nameParts.slice(1).join(' ');
            try {
                await addDoc(collection(db, "HallOfFame"), { playerId, firstName, lastName, photoUrl, timestamp: new Date().toISOString() });
                alert("Athlete inducted into the Hall of Fame!"); loadAdminHofList(); loadGuestFeeds();
            } catch (error) { console.error(error); alert("Failed to induct."); }
        });
    }
});

// --- PLAYER DASHBOARD & ANALYTICS ---
document.getElementById('toggleEditProfileBtn').addEventListener('click', () => { document.getElementById('editPlayerProfileForm').classList.toggle('hidden'); });

document.getElementById('editPlayerProfileForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const docId = e.target.dataset.docId; if (!docId) return alert("System Error: Identity token missing.");
    const submitBtn = document.getElementById('editProfileSubmitBtn'); submitBtn.textContent = "Uploading Details..."; submitBtn.disabled = true;
    try {
        let updateData = { mobile: document.getElementById('editMobile').value, address: document.getElementById('editAddress').value, school: document.getElementById('editSchool').value };
        const photoFile = document.getElementById('editPhoto').files[0];
        if (photoFile) { const photoUrl = await uploadImageToStorage(photoFile, 'player_photos'); updateData.photoUrl = photoUrl; }
        await updateDoc(doc(db, "Users", docId), updateData); alert("Success! Profile parameters updated."); window.location.reload(); 
    } catch (error) { console.error(error); alert("Database write failed."); submitBtn.textContent = "Update Profile"; submitBtn.disabled = false;}
});

async function loadPlayerDashboard(userData, docId) {
    let dName = userData.firstName ? `${userData.firstName} ${userData.lastName}` : userData.name;
    let photoHTML = userData.photoUrl ? `<img src="${userData.photoUrl}" class="profile-photo" alt="Profile Photo">` : '<div class="profile-photo" style="display:flex; align-items:center; justify-content:center; color:#555; font-size:10px;">NO PHOTO</div>';
    document.getElementById('playerProfileData').innerHTML = `${photoHTML}<p style="color:var(--brand-primary); font-weight:800; font-size:11px; margin-bottom:15px;">ID: ${userData.vpmId || "PENDING"}</p><p><strong>Legal Name</strong> ${dName}</p><p><strong>Address</strong> ${userData.address || "Pending"}</p><p><strong>Contact</strong> ${userData.mobile || "Pending"}</p><p><strong>Academic Inst.</strong> ${userData.school || "Pending"}</p><div class="divider"></div><p><strong>Assignment</strong> ${userData.group}</p><p><strong>Competency</strong> ${userData.level}</p><p><strong>Status</strong> <span style="color:${userData.careerStatus==='Playing'?'var(--success)':'var(--text-muted)'}">${userData.careerStatus || 'Playing'}</span></p><p><strong>Gov ID</strong> ${userData.mumbaiUpanagarId || "Pending"}</p>`;
    
    document.getElementById('editPlayerProfileForm').dataset.docId = docId; document.getElementById('editMobile').value = userData.mobile || ""; document.getElementById('editAddress').value = userData.address || ""; document.getElementById('editSchool').value = userData.school || "";

    const achList = document.getElementById('playerAchievementsList');
    try {
        const achSnap = await getDocs(query(collection(db, "Achievements"), where("playerId", "==", docId))); achList.innerHTML = "";
        if (achSnap.empty) achList.innerHTML = "<li>No official achievements on record.</li>";
        else achSnap.forEach(d => { 
            let data = d.data(); let medalsHTML = data.medals.map(m => `<span class="medal-badge">${m.medal} | ${m.eventType} ${m.eventType === 'Apparatus Championship' ? '- ' + m.apparatus : ''} (${m.level})</span>`).join('');
            achList.innerHTML += `<li><div style="width: 100%;"><strong style="color: var(--gold);">${data.title}</strong> <span style="float:right; color:var(--text-muted); font-size:12px;">${data.date}</span><br><small style="color: white; font-size: 14px; margin-bottom: 8px;">${data.description}</small><div>${medalsHTML}</div></div></li>`; 
        });
    } catch (error) { console.error(error); }

    // Merged Schedule List
    const scheduleList = document.getElementById('playerScheduleList'); scheduleList.innerHTML = "<li>Loading schedules...</li>";
    try {
        let schedules = []; const fbSnap = await getDocs(collection(db, "Schedules"));
        fbSnap.forEach(d => { let data = d.data(); if ((data.gender === "All" || data.gender === userData.gender) && (data.group === "All" || data.group === userData.group)) { schedules.push({...data, source: 'Internal', id: d.id}); } });
        const gcalEvents = await fetchGoogleCalendarEvents(); gcalEvents.forEach(ev => schedules.push({...ev, group: "All", source: 'Google'}));
        schedules.sort((a,b) => new Date(a.date) - new Date(b.date));

        scheduleList.innerHTML = "";
        schedules.forEach(data => {
            let gCalLink = generateGoogleCalLink(data.date, data.startTime, data.endTime, data.group); 
            scheduleList.innerHTML += `<li><div><strong style="color:${data.source==='Google'?'#4285F4':'white'};">${data.date} ${data.title ? '- ' + data.title : ''}</strong><br><small>${data.startTime} - ${data.endTime} | Tier: ${data.group}</small><div class="cal-links"><a href="${gCalLink}" target="_blank" class="cal-btn">Sync to Google</a></div></div></li>`; 
        });
        if(scheduleList.innerHTML === "") scheduleList.innerHTML = "<li>No active session broadcasts.</li>";
    } catch (error) { console.error(error); }

    buildCalendar('playerCalendar', userData.group, userData.gender);

    const feesList = document.getElementById('playerFeesList');
    try {
        const feesSnap = await getDocs(query(collection(db, "Fees"), where("playerId", "==", docId))); feesList.innerHTML = "";
        if (feesSnap.empty) feesList.innerHTML = "<li>No ledger entries found.</li>";
        else feesSnap.forEach(d => { let data = d.data(); feesList.innerHTML += `<li><div><strong>${data.month} ${data.year}</strong></div><strong style="color: var(--success);">CLEARED</strong></li>`; });
    } catch (error) { console.error(error); }

    let date = new Date(); let firstDay = new Date(date.getFullYear(), date.getMonth(), 1).toISOString().split('T')[0]; let lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().split('T')[0];
    document.getElementById('attFilterStart').value = firstDay; document.getElementById('attFilterEnd').value = lastDay;
    document.getElementById('applyAttFilterBtn').addEventListener('click', () => { calculateAttendance(docId, userData.group, document.getElementById('attFilterStart').value, document.getElementById('attFilterEnd').value); });
    calculateAttendance(docId, userData.group, firstDay, lastDay);
}

async function calculateAttendance(playerId, playerGroup, startDate, endDate) {
    const attList = document.getElementById('playerAttendanceList'); attList.innerHTML = "<li>Calculating...</li>";
    try {
        const schedSnap = await getDocs(collection(db, "Schedules")); let totalScheduled = 0;
        schedSnap.forEach(d => { let data = d.data(); if ((data.group === "All" || data.group === playerGroup) && data.date >= startDate && data.date <= endDate) { totalScheduled++; } });
        const attSnap = await getDocs(query(collection(db, "Attendance"), where("presentPlayers", "array-contains", playerId)));
        let totalAttended = 0; attList.innerHTML = "";
        attSnap.forEach(d => { let data = d.data(); if (data.date >= startDate && data.date <= endDate) { totalAttended++; attList.innerHTML += `<li><div><strong>${data.date}</strong></div><strong style="color: var(--success);">LOGGED</strong></li>`; } });

        if (totalAttended === 0) attList.innerHTML = "<li>No sessions attended in this period.</li>";
        document.getElementById('statScheduled').textContent = totalScheduled; document.getElementById('statAttended').textContent = totalAttended;
        let rate = totalScheduled > 0 ? Math.round((totalAttended / totalScheduled) * 100) : 0; document.getElementById('statRate').textContent = `${rate}%`;
    } catch (error) { console.error(error); attList.innerHTML = "<li>Error calculating stats.</li>"; }
}

// --- GUEST FEEDS & CMS ---
async function loadGuestFeeds() {
    const isAdmin = CURRENT_USER_ROLE === 'admin';
    
    const globalAchFeed = document.getElementById('globalAchievementsFeed');
    if (globalAchFeed) {
        try {
            const achSnap = await getDocs(collection(db, "Achievements")); globalAchFeed.innerHTML = "";
            if (achSnap.empty) { globalAchFeed.innerHTML = "<p class='loading-text'>Awaiting new records...</p>"; }
            else { achSnap.forEach(doc => { let data = doc.data(); let medalsHTML = data.medals.map(m => `<span class="medal-badge">${m.medal || m.type} | ${m.eventType} ${m.eventType === 'Apparatus Championship' && m.apparatus ? '- ' + m.apparatus : ''} (${m.level})</span>`).join(''); globalAchFeed.innerHTML += `<div class="blog-card achievement-card deletable-item"><h4>${data.title}</h4><p style="color: white; font-weight: bold; margin-bottom: 5px;">${data.playerName}</p><p>${data.description}</p><div style="margin: 15px 0;">${medalsHTML}</div><small>Awarded: ${data.date}</small> ${isAdmin ? `<br><button class="delete-doc-btn" style="margin-top:10px; margin-left:0;" data-col="Achievements" data-id="${doc.id}">Delete</button>` : ''}</div>`; }); }
        } catch(e) { globalAchFeed.innerHTML = "<p>Data retrieval failed.</p>"; }
    }

    const hofFeed = document.getElementById('guestHallOfFameFeed');
    if (hofFeed) {
        try {
            const hofSnap = await getDocs(collection(db, "HallOfFame")); hofFeed.innerHTML = "";
            if (hofSnap.empty) { hofFeed.innerHTML = "<p class='loading-text'>No legends inducted yet.</p>"; }
            else {
                let hofPlayers = [];
                hofSnap.forEach(docSnap => hofPlayers.push({ id: docSnap.id, ...docSnap.data(), score: 0 }));
                
                const achSnap = await getDocs(collection(db, "Achievements"));
                let playerScores = {};
                achSnap.forEach(achDoc => {
                    let data = achDoc.data();
                    if (!playerScores[data.playerId]) playerScores[data.playerId] = 0;
                    
                    let titleStr = (data.title || "").toLowerCase();
                    let medalsArray = data.medals || [];
                    
                    if (medalsArray.length === 0 && titleStr) {
                        let levelBase = 5; 
                        if (titleStr.includes("international")) levelBase = 1000;
                        else if (titleStr.includes("national") || titleStr.includes("khelo india") || titleStr.includes("all india")) levelBase = 100;
                        else if (titleStr.includes("state")) levelBase = 10;
                        
                        const parseCount = (regex) => { let match = titleStr.match(regex); return match ? parseInt(match[1]) : 0; };
                        let goldCount = Math.max((titleStr.match(/\bgold\b/g) || []).length, parseCount(/(\d+)\s+gold/));
                        let silverCount = Math.max((titleStr.match(/\bsilver\b/g) || []).length, parseCount(/(\d+)\s+silver/));
                        let bronzeCount = Math.max((titleStr.match(/\bbronze\b/g) || []).length, parseCount(/(\d+)\s+bronze/));
                        let isParticipant = titleStr.includes("participant") ? 1 : 0;
                        
                        let medalMultiplier = (goldCount * 3) + (silverCount * 2) + (bronzeCount * 1);
                        if (medalMultiplier === 0) medalMultiplier = isParticipant ? 0.5 : 1;
                        
                        playerScores[data.playerId] += (levelBase * medalMultiplier);
                    } else {
                        medalsArray.forEach(m => {
                            let levelBase = 5;
                            if (m.level === "International") levelBase = 1000;
                            else if (m.level === "National") levelBase = 100;
                            else if (m.level === "State") levelBase = 10;
                            
                            let medalMultiplier = 0.5;
                            if (m.medal === "Gold") medalMultiplier = 3;
                            else if (m.medal === "Silver") medalMultiplier = 2;
                            else if (m.medal === "Bronze") medalMultiplier = 1;
                            
                            playerScores[data.playerId] += (levelBase * medalMultiplier);
                        });
                    }
                });
                
                hofPlayers.forEach(p => p.score = playerScores[p.playerId] || 0);
                hofPlayers.sort((a, b) => b.score - a.score);
                
                hofPlayers.forEach(data => {
                    let card = document.createElement('div'); card.className = "premium-card"; card.style.textAlign = "center"; card.style.cursor = "pointer";
                    card.innerHTML = `<img src="${data.photoUrl || 'https://via.placeholder.com/150'}" style="width:120px;height:120px;border-radius:50%;object-fit:cover;border:3px solid var(--gold);margin-bottom:15px;"><h3 style="color:var(--gold);margin:0;font-size:22px;">${data.firstName} ${data.lastName}</h3><p style="color:var(--brand-primary);font-weight:600;margin-top:5px;font-size:14px;text-transform:uppercase;letter-spacing:1px;">Hall of Fame Inductee</p>`;
                    card.addEventListener('click', () => window.openHofModal(data)); hofFeed.appendChild(card);
                });
            }
        } catch(e) { console.error(e); hofFeed.innerHTML = "<p>Data retrieval failed.</p>"; }
    }

    const blogFeed = document.getElementById('guestBlogFeed');
    try {
        const blogsSnap = await getDocs(collection(db, "Blogs")); blogFeed.innerHTML = "";
        if (blogsSnap.empty) { blogFeed.innerHTML = "<p class='loading-text'>No transmissions active.</p>"; } 
        else { 
            blogsSnap.forEach(doc => { 
                let data = doc.data(); 
                let bannerHTML = data.bannerUrl ? `<img src="${data.bannerUrl}" class="blog-banner" alt="Banner">` : ''; let tagsArray = data.tags ? data.tags.split(',').map(tag => tag.trim()) : []; let tagsHTML = tagsArray.map(tag => `<span class="cms-tag">${tag}</span>`).join(''); let metaHTML = `<div class="cms-meta"><span class="cms-badge">${data.category}</span>${tagsHTML}</div>`;
                blogFeed.innerHTML += `<div class="blog-card deletable-item">${bannerHTML}${metaHTML}<h4>${data.title}</h4><div class="rich-text-content">${data.richContent}</div><small>SYS.DATE: ${new Date(data.timestamp).toLocaleDateString()}</small> ${isAdmin ? `<button class="delete-doc-btn" data-col="Blogs" data-id="${doc.id}">Delete</button>` : ''}</div>`; 
            }); 
        }
    } catch (e) { blogFeed.innerHTML = "<p>Data retrieval failed.</p>"; }
    
    const videoFeed = document.getElementById('guestVideoFeed');
    try {
        const videosSnap = await getDocs(collection(db, "Videos")); videoFeed.innerHTML = "";
        if (videosSnap.empty) { videoFeed.innerHTML = "<p class='loading-text'>Archive empty.</p>"; } 
        else { 
            videosSnap.forEach(doc => { 
                let data = doc.data(); 
                videoFeed.innerHTML += `<div class="deletable-item"><div class="video-container"><iframe src="https://www.youtube.com/embed/${data.videoId}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div> ${isAdmin ? `<button class="delete-doc-btn" style="margin-top:10px; width:100%; margin-left:0;" data-col="Videos" data-id="${doc.id}">Delete Video</button>` : ''}</div>`; 
            }); 
        }
    } catch (e) { videoFeed.innerHTML = "<p>Data retrieval failed.</p>"; }
}

document.getElementById('generateReportBtn').addEventListener('click', async () => {
    const container = document.getElementById('adminReportContainer'); const totalEl = document.getElementById('reportTotalPlayers'); const feesEl = document.getElementById('reportFeesCollected');
    container.classList.remove('hidden'); totalEl.textContent = "Loading..."; feesEl.textContent = "Loading...";
    try {
        const playersSnap = await getDocs(query(collection(db, "Users"), where("role", "==", "player"))); totalEl.textContent = playersSnap.size;
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]; const currentMonth = monthNames[new Date().getMonth()]; const currentYear = new Date().getFullYear().toString();
        const feesSnap = await getDocs(query(collection(db, "Fees"), where("month", "==", currentMonth), where("year", "==", currentYear))); feesEl.textContent = feesSnap.size; 
    } catch (error) { console.error(error); totalEl.textContent = "Error"; feesEl.textContent = "Error"; }
});

document.getElementById('medalRowsContainer').addEventListener('change', (e) => {
    if (e.target.classList.contains('medal-event-type')) {
        const row = e.target.closest('.medal-row'); const apparatusGroup = row.querySelector('.apparatus-group'); const apparatusSelect = apparatusGroup.querySelector('.medal-apparatus');
        if (e.target.value === 'Apparatus Championship') { apparatusGroup.classList.remove('hidden'); apparatusSelect.required = true; } else { apparatusGroup.classList.add('hidden'); apparatusSelect.required = false; apparatusSelect.value = ''; }
    }
});
document.getElementById('addMedalRowBtn').addEventListener('click', () => {
    const container = document.getElementById('medalRowsContainer');
    const rowHTML = `<div class="medal-row grid-form" style="margin-bottom: 10px;"><div class="form-group"><select class="medal-event-type" required><option value="">Event Type...</option><option value="All Round Championship">All Round Championship</option><option value="Apparatus Championship">Apparatus Championship</option><option value="Team Championship">Team Championship</option></select></div><div class="form-group apparatus-group hidden"><select class="medal-apparatus"><option value="">Apparatus...</option><option value="Pole">Pole</option><option value="Rope">Rope</option><option value="Hanging (Niradhar)">Hanging (Niradhar)</option></select></div><div class="form-group"><select class="medal-level" required><option value="">Level...</option><option value="District">District</option><option value="State">State</option><option value="National">National</option><option value="International">International</option><option value="Invitational">Invitational</option></select></div><div class="form-group"><select class="medal-type" required><option value="">Medal Type...</option><option value="Gold">Gold</option><option value="Silver">Silver</option><option value="Bronze">Bronze</option><option value="Participant">Participant</option></select></div></div>`;
    container.insertAdjacentHTML('beforeend', rowHTML);
});

document.getElementById('adminAchievementForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const playerVal = document.getElementById('adminAchievementPlayer').value; if (!playerVal) return alert("Select an athlete."); const [playerId, playerName] = playerVal.split('|');
    let medalsArray = []; const rows = document.querySelectorAll('.medal-row');
    rows.forEach(row => { let eventType = row.querySelector('.medal-event-type').value; let apparatus = row.querySelector('.medal-apparatus').value; medalsArray.push({ eventType: eventType, apparatus: eventType === 'Apparatus Championship' ? apparatus : 'All Apparatus', level: row.querySelector('.medal-level').value, medal: row.querySelector('.medal-type').value }); });
    try { 
        await addDoc(collection(db, "Achievements"), { playerId: playerId, playerName: playerName, title: document.getElementById('achievementTitle').value, description: document.getElementById('achievementDesc').value, date: document.getElementById('achievementDate').value, medals: medalsArray, timestamp: new Date().toISOString() }); 
        document.getElementById('adminAchievementForm').reset(); document.getElementById('medalRowsContainer').innerHTML = `<div class="medal-row grid-form" style="margin-bottom: 10px;"><div class="form-group"><select class="medal-event-type" required><option value="">Event Type...</option><option value="All Round Championship">All Round Championship</option><option value="Apparatus Championship">Apparatus Championship</option><option value="Team Championship">Team Championship</option></select></div><div class="form-group apparatus-group hidden"><select class="medal-apparatus"><option value="">Apparatus...</option><option value="Pole">Pole</option><option value="Rope">Rope</option><option value="Hanging (Niradhar)">Hanging (Niradhar)</option></select></div><div class="form-group"><select class="medal-level" required><option value="">Level...</option><option value="District">District</option><option value="State">State</option><option value="National">National</option><option value="International">International</option><option value="Invitational">Invitational</option></select></div><div class="form-group"><select class="medal-type" required><option value="">Medal Type...</option><option value="Gold">Gold</option><option value="Silver">Silver</option><option value="Bronze">Bronze</option><option value="Participant">Participant</option></select></div></div>`;
        alert("Success! Achievement securely logged."); loadGuestFeeds(); 
    } catch (error) { console.error(error); alert("Failed to log achievement."); }
});

document.getElementById('addBlogForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const richHTML = quill.root.innerHTML; if (quill.getText().trim() === "" && richHTML.indexOf("<img") === -1) return alert("Content block empty.");
    const submitBtn = document.getElementById('blogSubmitBtn'); submitBtn.textContent = "Publishing..."; submitBtn.disabled = true;
    try {
        const file = document.getElementById('blogCoverImage').files[0]; let coverUrl = ""; if (file) { coverUrl = await uploadImageToStorage(file, 'blog_covers'); }
        await addDoc(collection(db, "Blogs"), { title: document.getElementById('blogTitle').value, category: document.getElementById('blogCategory').value, tags: document.getElementById('blogTags').value, bannerUrl: coverUrl, richContent: richHTML, timestamp: new Date().toISOString() });
        document.getElementById('addBlogForm').reset(); quill.root.innerHTML = ''; alert("Transmission deployed."); loadGuestFeeds();
    } catch (error) { console.error(error); alert("Failed to publish."); } finally { submitBtn.textContent = "Publish to CMS"; submitBtn.disabled = false; }
});

function extractYouTubeID(url) { 
    if(url.length === 11) return url;
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(shorts\/)|(watch\?))\??v?=?([^#&?]*).*/; 
    const match = url.match(regExp); 
    return (match && match[8].length === 11) ? match[8] : null; 
}

document.getElementById('addVideoForm').addEventListener('submit', async (e) => { 
    e.preventDefault(); const videoId = extractYouTubeID(document.getElementById('videoUrl').value); 
    if (!videoId) return alert("Invalid URL. Ensure it's a standard YouTube link or just paste the 11-character video ID directly."); 
    try { await addDoc(collection(db, "Videos"), { videoId: videoId, timestamp: new Date().toISOString() }); document.getElementById('addVideoForm').reset(); alert("Archive updated."); loadGuestFeeds(); } catch (error) { console.error(error); } 
});

// --- REGISTRATION FORMS ---
document.getElementById('adminAddPlayerSubmitBtn').parentElement.parentElement.addEventListener('submit', async (e) => {
    e.preventDefault(); const submitBtn = document.getElementById('adminAddPlayerSubmitBtn'); submitBtn.textContent = "Checking Records..."; submitBtn.disabled = true;
    const fName = document.getElementById('playerFirstName').value.trim(); const lName = document.getElementById('playerLastName').value.trim(); const faName = document.getElementById('fatherName').value.trim(); const moName = document.getElementById('motherName').value.trim(); const fullName = `${fName} ${faName} ${lName}`;
    try {
        const dupCheck = await getDocs(query(collection(db, "Users"), where("role", "==", "player"), where("firstName", "==", fName), where("lastName", "==", lName), where("fatherName", "==", faName), where("motherName", "==", moName)));
        if (!dupCheck.empty) { alert("Registration Failed: A player with this exact name already exists."); submitBtn.textContent = "Execute Registration"; submitBtn.disabled = false; return; }
        submitBtn.textContent = "Uploading Photo...";
        let photoUrl = ""; const file = document.getElementById('playerPhoto').files[0]; if (file) photoUrl = await uploadImageToStorage(file, 'player_photos');
        let playerData = { vpmId: generateVPMId(), role: "player", email: document.getElementById('playerEmail').value, firstName: fName, lastName: lName, fatherName: faName, motherName: moName, name: fullName, photoUrl: photoUrl, dob: document.getElementById('playerDOB').value, gender: document.getElementById('playerGender').value, mobile: document.getElementById('playerMobile').value, address: document.getElementById('playerAddress').value, school: document.getElementById('playerSchool').value, mumbaiUpanagarId: document.getElementById('upnagarId').value, dateJoined: document.getElementById('dateJoined').value, level: document.getElementById('playerLevel').value, group: document.getElementById('playerGroup').value, careerStatus: document.getElementById('playerStatus').value };
        await addDoc(collection(db, "Users"), playerData); await pushToGoogleSheet([playerData]); 
        document.getElementById('addPlayerForm').reset(); alert("Athlete record generated."); loadAdminDashboard();
    } catch (error) { console.error(error); } finally { submitBtn.textContent = "Execute Registration"; submitBtn.disabled = false; }
});

document.getElementById('coachAddPlayerSubmitBtn').parentElement.parentElement.addEventListener('submit', async (e) => {
    e.preventDefault(); const submitBtn = document.getElementById('coachAddPlayerSubmitBtn'); submitBtn.textContent = "Checking Records..."; submitBtn.disabled = true;
    const fName = document.getElementById('coachPlayerFirstName').value.trim(); const lName = document.getElementById('coachPlayerLastName').value.trim(); const faName = document.getElementById('coachFatherName').value.trim(); const moName = document.getElementById('coachMotherName').value.trim(); const fullName = `${fName} ${faName} ${lName}`;
    try {
        const dupCheck = await getDocs(query(collection(db, "Users"), where("role", "==", "player"), where("firstName", "==", fName), where("lastName", "==", lName), where("fatherName", "==", faName), where("motherName", "==", moName)));
        if (!dupCheck.empty) { alert("Registration Failed: A player with this exact name already exists."); submitBtn.textContent = "Execute Registration"; submitBtn.disabled = false; return; }
        submitBtn.textContent = "Uploading Photo...";
        let photoUrl = ""; const file = document.getElementById('coachPlayerPhoto').files[0]; if (file) photoUrl = await uploadImageToStorage(file, 'player_photos');
        let playerData = { vpmId: generateVPMId(), role: "player", email: document.getElementById('coachPlayerEmail').value, firstName: fName, lastName: lName, fatherName: faName, motherName: moName, name: fullName, photoUrl: photoUrl, dob: document.getElementById('coachPlayerDOB').value, gender: document.getElementById('coachPlayerGender').value, mobile: document.getElementById('coachPlayerMobile').value, address: document.getElementById('coachPlayerAddress').value, school: document.getElementById('coachPlayerSchool').value, mumbaiUpanagarId: "", dateJoined: new Date().toISOString().split('T')[0], level: "District", group: "Regular", careerStatus: document.getElementById('coachPlayerStatus').value };
        await addDoc(collection(db, "Users"), playerData); await pushToGoogleSheet([playerData]); 
        document.getElementById('coachAddPlayerForm').reset(); alert("Athlete record generated."); loadCoachDashboard();
    } catch (error) { console.error(error); } finally { submitBtn.textContent = "Execute Registration"; submitBtn.disabled = false; }
});

const modal = document.getElementById('masterEditModal');
const closeBtn = document.getElementById('closeModalBtn');
let currentEditDocId = null;
closeBtn.addEventListener('click', () => { modal.classList.add('hidden'); }); window.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

async function openEditModal(docId) {
    currentEditDocId = docId; const docSnap = await getDocs(query(collection(db, "Users"), where("__name__", "==", docId))); if (docSnap.empty) return alert("Record not found.");
    let p = docSnap.docs[0].data();
    document.getElementById('modalVpmIdLabel').textContent = p.vpmId || "PENDING"; document.getElementById('modalFirstName').value = p.firstName || ""; document.getElementById('modalLastName').value = p.lastName || ""; document.getElementById('modalFatherName').value = p.fatherName || ""; document.getElementById('modalMotherName').value = p.motherName || ""; document.getElementById('modalMobile').value = p.mobile || ""; document.getElementById('modalAddress').value = p.address || ""; document.getElementById('modalSchool').value = p.school || ""; document.getElementById('modalStatus').value = p.careerStatus || "Playing"; document.getElementById('modalUpanagarId').value = p.mumbaiUpanagarId || ""; document.getElementById('modalLevel').value = p.level || "District"; document.getElementById('modalGroup').value = p.group || "Regular";
    modal.classList.remove('hidden');
}

document.getElementById('masterEditPlayerForm').addEventListener('submit', async (e) => {
    e.preventDefault(); if (!currentEditDocId) return; const btn = document.getElementById('modalSubmitBtn'); btn.textContent = "Saving..."; btn.disabled = true;
    try {
        const fName = document.getElementById('modalFirstName').value.trim(); const lName = document.getElementById('modalLastName').value.trim(); const faName = document.getElementById('modalFatherName').value.trim(); const moName = document.getElementById('modalMotherName').value.trim();
        await updateDoc(doc(db, "Users", currentEditDocId), { firstName: fName, lastName: lName, fatherName: faName, motherName: moName, name: `${fName} ${faName} ${lName}`, mobile: document.getElementById('modalMobile').value, address: document.getElementById('modalAddress').value, school: document.getElementById('modalSchool').value, careerStatus: document.getElementById('modalStatus').value, mumbaiUpanagarId: document.getElementById('modalUpanagarId').value, level: document.getElementById('modalLevel').value, group: document.getElementById('modalGroup').value });
        alert("Success! Record updated. Triggering background Sheet Sync..."); modal.classList.add('hidden'); document.getElementById('syncSheetsBtn').click(); 
    } catch (e) { console.error(e); alert("Update failed."); } finally { btn.textContent = "Commit Changes"; btn.disabled = false; }
});

async function populatePlayerDropdowns() {
    const adminSelect = document.getElementById('adminFeePlayer'); const coachSelect = document.getElementById('coachFeePlayer'); const adminAchieveSelect = document.getElementById('adminAchievementPlayer');
    try {
        const snapshot = await getDocs(query(collection(db, "Users"), where("role", "==", "player"))); let optionsHTML = '<option value="">Select Athlete...</option>';
        snapshot.forEach(doc => { let data = doc.data(); let dName = data.firstName ? `${data.firstName} ${data.lastName}` : data.name; optionsHTML += `<option value="${doc.id}|${dName}|${data.photoUrl || ''}">${dName} (${data.vpmId || "No ID"})</option>`; });
        const adminHofPlayer = document.getElementById('adminHofPlayer');
        if (adminSelect) adminSelect.innerHTML = optionsHTML; if (coachSelect) coachSelect.innerHTML = optionsHTML; if (adminAchieveSelect) adminAchieveSelect.innerHTML = optionsHTML; if (adminHofPlayer) adminHofPlayer.innerHTML = optionsHTML;
    } catch (error) { console.error(error); }
}

async function loadRecentFees(listId) {
    const listElement = document.getElementById(listId); if (!listElement) return;
    try { 
        const snapshot = await getDocs(collection(db, "Fees")); listElement.innerHTML = ""; 
        if (snapshot.empty) return listElement.innerHTML = "<li>Ledger is empty.</li>"; 
        snapshot.forEach(doc => { 
            let data = doc.data(); 
            // ONLY Admin gets the delete button for fees
            let deleteBtn = CURRENT_USER_ROLE === 'admin' ? `<button class="delete-doc-btn" data-col="Fees" data-id="${doc.id}">Delete</button>` : '';
            listElement.innerHTML += `<li class="deletable-item"><div><strong>${data.playerName}</strong> <br> <small>${data.month} ${data.year}</small></div><div><strong style="color: var(--success);">PAID</strong> ${deleteBtn}</div></li>`; 
        }); 
    } catch (error) { console.error(error); }
}

document.getElementById('adminMarkFeeForm').addEventListener('submit', async (e) => { e.preventDefault(); submitFeeRecord('adminFeePlayer', 'adminFeeMonth', 'adminFeeYear', 'adminMarkFeeForm'); });
document.getElementById('coachMarkFeeForm').addEventListener('submit', async (e) => { e.preventDefault(); submitFeeRecord('coachFeePlayer', 'coachFeeMonth', 'coachFeeYear', 'coachMarkFeeForm'); });
async function submitFeeRecord(playerSelectId, monthId, yearId, formId) {
    const playerVal = document.getElementById(playerSelectId).value; if (!playerVal) return alert("Select an athlete."); const [playerId, playerName] = playerVal.split('|'); const month = document.getElementById(monthId).value; const year = document.getElementById(yearId).value;
    try { await addDoc(collection(db, "Fees"), { playerId, playerName, month, year, timestamp: new Date().toISOString() }); document.getElementById(formId).reset(); alert(`System Updated: ${playerName} cleared for ${month} ${year}.`); loadRecentFees('coachRecentFeesList'); } catch (error) { console.error(error); }
}

document.getElementById('payFeesBtn').addEventListener('click', () => { alert("External Payment Gateway offline. Consult administration."); });
document.querySelectorAll('.buy-merch-btn').forEach(btn => { btn.addEventListener('click', async (e) => { if (e.target.dataset.loggedIn === "true") alert("Routing to secure checkout..."); else { try { await signInWithPopup(auth, provider); } catch (error) { console.error(error); } } }); });

document.getElementById('assignRoleForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const email = document.getElementById('roleEmail').value; const name = document.getElementById('roleName').value; const role = document.getElementById('roleSelect').value;
    try { const snapshot = await getDocs(query(collection(db, "Users"), where("email", "==", email))); if (!snapshot.empty) { await updateDoc(doc(db, "Users", snapshot.docs[0].id), { role, name }); alert(`Clearance updated: ${role}.`); } else { await addDoc(collection(db, "Users"), { email, name, role }); alert(`Identity created: ${role}.`); } document.getElementById('assignRoleForm').reset(); loadAdminDashboard(); } catch (error) { console.error(error); }
});

async function loadAdminDashboard() {
    const adminPlayerList = document.getElementById('adminPlayerList');
    try { 
        const snapshot = await getDocs(query(collection(db, "Users"), where("role", "==", "player"))); 
        loadAdminHofList();
        adminPlayerList.innerHTML = ""; 
        snapshot.forEach(docSnap => { 
            let data = docSnap.data(); let dName = data.firstName ? `${data.firstName} ${data.lastName}` : data.name; 
            adminPlayerList.innerHTML += `<li class="deletable-item"><div><strong>${dName}</strong><br><small>${data.group} | ID: ${data.vpmId || 'PENDING'}</small></div> <div><button class="edit-player-btn" data-docid="${docSnap.id}">Edit</button> <button class="delete-doc-btn" data-col="Users" data-id="${docSnap.id}">Delete</button></div></li>`; 
        }); 
    } catch (error) { console.error(error); }
    buildCalendar('adminCalendar');
}

async function loadCoachDashboard() {
    const coachPlayerList = document.getElementById('coachPlayerList');
    try { 
        const snapshot = await getDocs(query(collection(db, "Users"), where("role", "==", "player"))); 
        coachPlayerList.innerHTML = ""; 
        snapshot.forEach(docSnap => { 
            let data = docSnap.data(); let dName = data.firstName ? `${data.firstName} ${data.lastName}` : data.name; 
            // Coaches DO NOT get the Delete button, only Edit
            coachPlayerList.innerHTML += `<li><div><strong>${dName}</strong><br><small>${data.group} | ID: ${data.vpmId || 'PENDING'}</small></div> <button class="edit-player-btn" data-docid="${docSnap.id}">Edit</button> </li>`; 
        }); 
    } catch (error) { console.error(error); }
    buildCalendar('coachCalendar');
}

document.getElementById('loadAttendanceListBtn').addEventListener('click', async () => {
    const selectedGroup = document.getElementById('attendanceGroup').value; const togglesList = document.getElementById('attendanceTogglesList'); if (!selectedGroup) return alert("Filter requirement missing."); document.getElementById('attendanceTogglesContainer').classList.remove('hidden');
    try { const snapshot = await getDocs(query(collection(db, "Users"), where("role", "==", "player"), where("group", "==", selectedGroup))); togglesList.innerHTML = ""; snapshot.forEach(docSnap => { let data = docSnap.data(); let dName = data.firstName ? `${data.firstName} ${data.lastName}` : data.name; togglesList.innerHTML += `<li onclick="this.querySelector('input').click()"><div><strong>${dName}</strong></div><input type="checkbox" class="attendance-checkbox" value="${docSnap.id}" onclick="event.stopPropagation()"></li>`; }); } catch (error) { console.error(error); }
});

document.getElementById('attendanceForm').addEventListener('submit', async (e) => {
    e.preventDefault(); try { await addDoc(collection(db, "Attendance"), { date: document.getElementById('attendanceDate').value, group: document.getElementById('attendanceGroup').value, presentPlayers: Array.from(document.querySelectorAll('.attendance-checkbox')).filter(box => box.checked).map(box => box.value), timestamp: new Date().toISOString() }); document.getElementById('attendanceForm').reset(); document.getElementById('attendanceTogglesContainer').classList.add('hidden'); alert("Register logged."); } catch (error) { console.error(error); }
});

document.getElementById('adminSchedulePracticeForm').addEventListener('submit', async (e) => { 
    e.preventDefault(); try { await addDoc(collection(db, "Schedules"), { date: document.getElementById('adminPracticeDate').value, startTime: document.getElementById('adminPracticeStartTime').value, endTime: document.getElementById('adminPracticeEndTime').value, gender: document.getElementById('adminPracticeGender').value, group: document.getElementById('adminPracticeGroup').value }); document.getElementById('adminSchedulePracticeForm').reset(); alert("Broadcast active."); buildCalendar('adminCalendar'); } catch (error) { console.error(error); } 
});
document.getElementById('coachSchedulePracticeForm')?.addEventListener('submit', async (e) => { 
    e.preventDefault(); try { await addDoc(collection(db, "Schedules"), { date: document.getElementById('coachPracticeDate').value, startTime: document.getElementById('coachPracticeStartTime').value, endTime: document.getElementById('coachPracticeEndTime').value, gender: document.getElementById('coachPracticeGender').value, group: document.getElementById('coachPracticeGroup').value }); document.getElementById('coachSchedulePracticeForm').reset(); alert("Broadcast active."); buildCalendar('coachCalendar'); } catch (error) { console.error(error); } 
});