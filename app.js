import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-storage.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  getFirestore, collection, getDocs, addDoc, doc, getDoc, setDoc, deleteDoc,
  updateDoc, serverTimestamp, query, where
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAmyF8_yObZ2-zFFBNIdVs42Ep4_GQ1N-I",
  authDomain: "borrowbox-7122f.firebaseapp.com",
  projectId: "borrowbox-7122f",
  storageBucket: "borrowbox-7122f.firebasestorage.app",
  messagingSenderId: "982923941758",
  appId: "1:982923941758:web:e8a31882ce3d92a138052f",
  measurementId: "G-1HBXTBVRM7"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
// CHANGE THIS to the exact email address of your trusted admin account.
const ADMIN_EMAILS = ["gowdanayana117@gmail.com"];
let activeChatTransaction = null;

const itemsGrid = document.getElementById("itemsGrid");
const searchInput = document.getElementById("searchInput");
const loginBtn = document.getElementById("loginBtn");
const addItemBtn = document.getElementById("addItemBtn");
let allItems = [];
let activeCategory = "All";
let toastTimer;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
function showMessage(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3500);
}
function errorMessage(error) {
  console.error(error);
  const code = error?.code || "";
  if (code.includes("permission-denied")) return "Permission denied. Please publish the provided Firestore rules.";
  if (code.includes("email-already-in-use")) return "That email already has an account. Choose Sign in.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "Email or password is incorrect.";
  if (code.includes("weak-password")) return "Password must contain at least 6 characters.";
  return error?.message || "Something went wrong. Please try again.";
}

async function loadItems() {
  try {
    const snapshot = await getDocs(collection(db, "items"));
    allItems = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderItems();
    if (auth.currentUser) await loadDashboard();
  } catch (error) {
    console.error("Loading items:", error);
    itemsGrid.innerHTML = `<div class="empty-state"><span>⚠️</span><h3>Unable to load items</h3><p>${escapeHTML(errorMessage(error))}</p></div>`;
  }
}

function renderItems() {
  const query = (searchInput?.value || "").trim().toLowerCase();
  const filtered = allItems.filter(item => {
    const matchesSearch = [item.name, item.description, item.category, item.ownerEmail]
      .some(value => String(value || "").toLowerCase().includes(query));
    const matchesCategory = activeCategory === "All" ||
      String(item.category || "Other").toLowerCase() === activeCategory.toLowerCase();
    return matchesSearch && matchesCategory;
  });

  document.getElementById("itemCount").textContent = `${filtered.length} item${filtered.length === 1 ? "" : "s"} found`;
  if (!filtered.length) {
    itemsGrid.innerHTML = `<div class="empty-state"><span>📦</span><h3>No matching items found</h3><p>Try another search or add the first item to the community shelf.</p></div>`;
    return;
  }

  itemsGrid.innerHTML = filtered.map(item => {
    const ownItem = auth.currentUser && item.ownerId === auth.currentUser.uid;
    const available = item.available === true;
    const icon = ({Academic:"📚", Electronics:"🔌", Creative:"🎨", Sports:"🏸"})[item.category] || "📦";
    return `<article class="item-card">
      <div class="item-card-image">${item.imageUrl ? `<img src="${escapeHTML(item.imageUrl)}" alt="${escapeHTML(item.name || "Borrowed item")}" loading="lazy">` : icon}</div>
      <div class="item-card-body">
        <h3>${escapeHTML(item.name || "Untitled item")}</h3>
        <p>${escapeHTML(item.description || "No description provided.")}</p>
        <div class="item-card-meta"><span>${escapeHTML(item.category || "Other")}</span><span class="availability ${available ? "" : "unavailable"}">${available ? "Available" : "Unavailable"}</span></div>
        <p class="owner-label">${item.isPaid && Number(item.rentalPrice) > 0 ? `Rental: ₹${escapeHTML(item.rentalPrice)} ${item.priceType === "per day" ? "/ day" : "fixed"}` : "Free to borrow"}</p>
        <p class="owner-label">${ownItem ? "Your item" : item.ownerEmail ? `Listed by ${escapeHTML(item.ownerEmail)}` : "Campus community"}</p>
        ${ownItem ? `<button class="request-btn" disabled>Your listing</button>` :
          available ? `<button class="request-btn" data-item-id="${escapeHTML(item.id)}">Request to Borrow</button>` :
          `<button class="request-btn" disabled>Currently unavailable</button>`}
      </div>
    </article>`;
  }).join("");
}

itemsGrid.addEventListener("click", async event => {
  const button = event.target.closest(".request-btn[data-item-id]");
  if (!button) return;
  const user = auth.currentUser;
  if (!user) { showMessage("Please sign in before requesting an item."); return; }
  const item = allItems.find(i => i.id === button.dataset.itemId);
  if (!item || item.ownerId === user.uid) { showMessage("You cannot request your own item."); return; }
  button.disabled = true;
  try {
    await addDoc(collection(db, "borrowRequests"), {
      itemId: item.id,
      borrowerId: user.uid,
      borrowerEmail: user.email || "",
      ownerId: item.ownerId || "",
      ownerEmail: item.ownerEmail || "",
      itemName: item.name || "Borrowed item",
      isPaid: item.isPaid === true,
      rentalPrice: Number(item.rentalPrice || 0),
      priceType: item.priceType || "fixed",
      message: `I would like to borrow ${item.name}.`,
      status: "pending",
      createdAt: serverTimestamp()
    });
    showMessage("Borrow request submitted successfully!");
    await loadDashboard();
  } catch (error) {
    showMessage(errorMessage(error));
  } finally {
    button.disabled = false;
  }
});

searchInput?.addEventListener("input", renderItems);
document.getElementById("searchBtn")?.addEventListener("click", renderItems);
document.querySelectorAll(".category").forEach(button => {
  button.addEventListener("click", () => {
    activeCategory = button.dataset.category || "All";
    document.querySelectorAll(".category").forEach(b => b.classList.toggle("active", b === button));
    renderItems();
  });
});

loginBtn?.addEventListener("click", async () => {
  if (auth.currentUser) {
    try { await signOut(auth); showMessage("Signed out successfully."); }
    catch (error) { showMessage(errorMessage(error)); }
    return;
  }
  const choice = prompt("Type SIGNIN to sign in, or SIGNUP to create an account:");
  if (!choice) return;
  const email = prompt("Enter your email address:");
  if (!email) return;
  const password = prompt("Enter your password (at least 6 characters):");
  if (!password) return;
  try {
    if (choice.trim().toLowerCase() === "signup") {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await setDoc(doc(db, "users", credential.user.uid), {
        uid: credential.user.uid, email: credential.user.email, createdAt: serverTimestamp()
      });
      showMessage("Account created and signed in!");
    } else {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      showMessage("Signed in successfully!");
    }
  } catch (error) { showMessage(errorMessage(error)); }
});

addItemBtn?.addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) { showMessage("Please sign in first."); return; }
  const name = prompt("Item name (example: Casio Calculator):");
  if (!name?.trim()) return;
  const description = prompt("Short description:");
  if (description === null) return;
  const categoryInput = prompt("Category: Academic, Electronics, Creative, Sports, or Other", "Academic");
  if (categoryInput === null) return;
  const allowed = ["Academic", "Electronics", "Creative", "Sports", "Other"];
  const category = allowed.find(c => c.toLowerCase() === categoryInput.trim().toLowerCase()) || "Other";
  const pricingChoice = prompt("Is this item FREE or PAID? Type FREE or PAID", "FREE");
  if (pricingChoice === null) return;
  const isPaid = pricingChoice.trim().toLowerCase() === "paid";
  let rentalPrice = 0;
  let priceType = "fixed";
  if (isPaid) {
    const price = prompt("Enter rental amount in INR (example: 20)", "20");
    if (price === null) return;
    rentalPrice = Number(price);
    if (!Number.isFinite(rentalPrice) || rentalPrice <= 0) { showMessage("Enter a valid amount greater than ₹0."); return; }
    const unit = prompt("Type DAILY for per-day rent, or FIXED for one fixed rental price", "DAILY");
    if (unit === null) return;
    priceType = unit.trim().toLowerCase() === "daily" ? "per day" : "fixed";
  }
  let imageUrl = "";
  try {
    const wantImage = confirm("Would you like to upload a photo for this item? Click OK to choose a photo, or Cancel to continue without one.");
    if (wantImage) {
      const file = await new Promise(resolve => {
        const picker = document.createElement("input"); picker.type = "file"; picker.accept = "image/*";
        picker.onchange = () => resolve(picker.files?.[0] || null); picker.click();
      });
      if (file) {
        if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) { showMessage("Choose an image under 5 MB."); return; }
        const path = `item-photos/${user.uid}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const uploaded = await uploadBytes(storageRef(storage, path), file);
        imageUrl = await getDownloadURL(uploaded.ref);
      }
    }
    await addDoc(collection(db, "items"), {
      name: name.trim(),
      description: description.trim(),
      category,
      isPaid,
      rentalPrice,
      priceType,
      available: true,
      ownerId: user.uid,
      ownerEmail: user.email || "",
      imageUrl,
      createdAt: serverTimestamp()
    });
    showMessage("Item added to the community shelf!");
    await loadItems();
  } catch (error) { showMessage(errorMessage(error)); }
});

document.getElementById("refreshDashboardBtn")?.addEventListener("click", loadDashboard);

function statusPill(status) {
  const s = String(status || "pending").toLowerCase();
  return `<span class="status-pill status-${escapeHTML(s)}">${escapeHTML(s.replaceAll("_", " "))}</span>`;
}
function emptyText(text) { return `<p class="muted">${escapeHTML(text)}</p>`; }

async function loadDashboard() {
  const user = auth.currentUser;
  const ids = ["myRequests", "incomingRequests", "myItems", "myTransactions"];
  if (!user) {
    ids.forEach(id => document.getElementById(id).innerHTML = emptyText("Sign in to view this section."));
    return;
  }
  try {
    // Firestore rules are not filters: query only records the signed-in user may read.
    const [myRequestSnap, incomingSnap, borrowedSnap, lentSnap] = await Promise.all([
      getDocs(query(collection(db, "borrowRequests"), where("borrowerId", "==", user.uid))),
      getDocs(query(collection(db, "borrowRequests"), where("ownerId", "==", user.uid))),
      getDocs(query(collection(db, "transactions"), where("borrowerId", "==", user.uid))),
      getDocs(query(collection(db, "transactions"), where("ownerId", "==", user.uid)))
    ]);
    const myRequests = myRequestSnap.docs.map(d => ({id:d.id, ...d.data()}));
    const incoming = incomingSnap.docs.map(d => ({id:d.id, ...d.data()}));
    const myItems = allItems.filter(i => i.ownerId === user.uid);
    const transactionMap = new Map();
    [...borrowedSnap.docs, ...lentSnap.docs].forEach(d => transactionMap.set(d.id, {id:d.id, ...d.data()}));
    const myTransactions = [...transactionMap.values()];

    document.getElementById("myRequests").innerHTML = myRequests.length ? myRequests.map(r => {
      const item = allItems.find(i => i.id === r.itemId);
      return `<article class="record"><div><strong>${escapeHTML(item?.name || r.message || "Borrow request")}</strong><p>Submitted ${formatDate(r.createdAt)}</p></div>${statusPill(r.status)}</article>`;
    }).join("") : emptyText("You haven't requested any items yet.");

    document.getElementById("incomingRequests").innerHTML = incoming.length ? incoming.map(r => {
      const item = allItems.find(i => i.id === r.itemId);
      const canRespond = r.status === "pending";
      return `<article class="record record-stack"><div class="record-top"><div><strong>${escapeHTML(item?.name || r.message || "Item request")}</strong><p>From ${escapeHTML(r.borrowerEmail || "a borrower")} · ${formatDate(r.createdAt)}</p></div>${statusPill(r.status)}</div>
        ${canRespond ? `<div class="record-actions"><button class="small-btn approve-btn" data-request-id="${escapeHTML(r.id)}" data-action="approved">Approve</button><button class="small-btn reject-btn" data-request-id="${escapeHTML(r.id)}" data-action="rejected">Reject</button></div>` : ""}</article>`;
    }).join("") : emptyText("No one has requested your items yet.");

    document.getElementById("myItems").innerHTML = myItems.length ? myItems.map(item =>
      `<article class="record"><div><strong>${escapeHTML(item.name)}</strong><p>${escapeHTML(item.category || "Other")}</p></div>${statusPill(item.available ? "available" : "unavailable")}</article>`
    ).join("") : emptyText("You haven't listed any items yet. Use + Add item.");

    document.getElementById("myTransactions").innerHTML = myTransactions.length ? myTransactions.map(t => {
      const item = allItems.find(i => i.id === t.itemId);
      const isOwner = t.ownerId === user.uid;
      const canReturn = isOwner && t.status === "active";
      const contactEmail = isOwner ? (t.borrowerEmail || "Not provided") : (t.ownerEmail || "Not provided");
      const paymentLine = t.isPaid && Number(t.rentalPrice) > 0 ? `Rent: ₹${escapeHTML(t.rentalPrice)}${t.priceType === "per day" ? " / day" : " fixed"} · ${escapeHTML(t.paymentMethod || "UPI or cash")} · Payment: ${escapeHTML(t.paymentStatus || "not recorded")}` : "Free loan";
      const canMarkPaid = isOwner && t.isPaid && t.status === "active" && t.paymentStatus !== "received";
      return `<article class="record record-stack"><div class="record-top"><div><strong>${escapeHTML(item?.name || t.itemName || "Borrowed item")}</strong><p>${isOwner ? "You lent this item" : "You borrowed this item"}</p></div>${statusPill(t.status)}</div>
      <p>Contact ${isOwner ? "borrower" : "owner"}: <a href="mailto:${escapeHTML(contactEmail)}">${escapeHTML(contactEmail)}</a></p>
      <p>Pickup: ${escapeHTML(t.pickupDate || "Arrange by contacting each other")} ${escapeHTML(t.pickupTime || "")} · Location: ${escapeHTML(t.meetingLocation || "Agree together")}</p>
      <p>${paymentLine}</p>
      ${canMarkPaid ? `<div class="record-actions"><button class="small-btn approve-btn" data-transaction-id="${escapeHTML(t.id)}" data-action="payment-received">Confirm payment received</button></div>` : ""}
      ${canReturn ? `<div class="record-actions"><button class="small-btn approve-btn" data-transaction-id="${escapeHTML(t.id)}" data-action="returned">Mark returned</button></div>` : ""}</article>`;
    }).join("") : emptyText("No active loans yet.");
  } catch (error) {
    console.error("Dashboard:", error);
    ids.forEach(id => document.getElementById(id).innerHTML = emptyText(errorMessage(error)));
  }
}
function formatDate(timestamp) {
  try {
    if (!timestamp) return "just now";
    const date = typeof timestamp.toDate === "function" ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString();
  } catch { return "recently"; }
}

document.getElementById("incomingRequests")?.addEventListener("click", async event => {
  const button = event.target.closest("[data-request-id][data-action]");
  if (!button) return;
  const user = auth.currentUser;
  if (!user) return;
  const requestId = button.dataset.requestId;
  const action = button.dataset.action;
  button.disabled = true;
  try {
    const requestRef = doc(db, "borrowRequests", requestId);
    const requestSnap = await getDoc(requestRef);
    if (!requestSnap.exists()) throw new Error("This request no longer exists.");
    const request = requestSnap.data();
    if (request.ownerId !== user.uid || request.status !== "pending") throw new Error("You cannot update this request.");
    await updateDoc(requestRef, { status: action, respondedAt: serverTimestamp() });
    if (action === "approved") {
      const item = allItems.find(i => i.id === request.itemId);
      if (item) {
        await updateDoc(doc(db, "items", item.id), { available: false });
        item.available = false;
      }
      const pickupDate = prompt("Pickup date (example: 20/10/2026). Leave blank to arrange later.", "");
      const pickupTime = prompt("Pickup time (example: 4:00 PM). Leave blank to arrange later.", "");
      const meetingLocation = prompt("Meeting location (example: College library). Leave blank to arrange later.", "");
      const paymentMethod = request.isPaid ? prompt("Payment method: type UPI or CASH", "UPI") : "none";
      await addDoc(collection(db, "transactions"), {
        requestId, itemId: request.itemId, itemName: item?.name || request.itemName || request.message || "Borrowed item",
        ownerId: request.ownerId, borrowerId: request.borrowerId,
        ownerEmail: request.ownerEmail || user.email || "",
        borrowerEmail: request.borrowerEmail || "",
        isPaid: request.isPaid === true, rentalPrice: Number(request.rentalPrice || 0),
        priceType: request.priceType || "fixed",
        paymentMethod: request.isPaid ? (String(paymentMethod || "UPI").trim().toUpperCase() === "CASH" ? "Cash" : "UPI") : "none",
        paymentStatus: request.isPaid ? "awaiting payment" : "not required",
        pickupDate: pickupDate || "", pickupTime: pickupTime || "", meetingLocation: meetingLocation || "",
        status: "active", startedAt: serverTimestamp()
      });
      showMessage("Request approved. The item is now marked unavailable.");
    } else {
      showMessage("Request rejected.");
    }
    renderItems();
    await loadDashboard();
  } catch (error) { showMessage(errorMessage(error)); }
  finally { button.disabled = false; }
});

document.getElementById("myTransactions")?.addEventListener("click", async event => {
  const button = event.target.closest("[data-transaction-id][data-action]");
  if (!button) return;
  const user = auth.currentUser;
  if (!user) return;
  button.disabled = true;
  try {
    const transactionRef = doc(db, "transactions", button.dataset.transactionId);
    const transactionSnap = await getDoc(transactionRef);
    if (!transactionSnap.exists()) throw new Error("Transaction not found.");
    const transaction = transactionSnap.data();
    if (transaction.ownerId !== user.uid) throw new Error("Only the owner can update this transaction.");
    if (button.dataset.action === "payment-received") {
      if (transaction.status !== "active" || !transaction.isPaid) throw new Error("This transaction is not awaiting rental payment.");
      await updateDoc(transactionRef, { paymentStatus: "received", paymentReceivedAt: serverTimestamp() });
      showMessage("Payment marked as received. This is a manual record, not gateway verification.");
      await loadDashboard();
      return;
    }
    if (transaction.status !== "active") throw new Error("This loan is not active.");
    await updateDoc(transactionRef, { status: "returned", returnedAt: serverTimestamp() });
    const itemRef = doc(db, "items", transaction.itemId);
    const itemSnap = await getDoc(itemRef);
    if (itemSnap.exists()) {
      await updateDoc(itemRef, { available: true });
      const localItem = allItems.find(i => i.id === transaction.itemId);
      if (localItem) localItem.available = true;
    }
    showMessage("Item marked as returned and available again.");
    renderItems();
    await loadDashboard();
  } catch (error) { showMessage(errorMessage(error)); }
  finally { button.disabled = false; }
});

onAuthStateChanged(auth, async user => {
  loginBtn.textContent = user ? "Sign out" : "Sign in";
  addItemBtn.hidden = !user;
  await loadItems();
  await loadDashboard();
  await loadExtras();
});


// Extra community features: chat, reviews, notifications and admin overview.
const notificationsList = document.getElementById("notificationsList");
const chatLoans = document.getElementById("chatLoans");
const reviewsList = document.getElementById("reviewsList");
const adminPanel = document.getElementById("adminPanel");

async function loadExtras() {
  const user = auth.currentUser;
  if (!user) {
    [notificationsList, chatLoans, reviewsList, adminPanel].forEach(el => { if (el) el.innerHTML = emptyText("Sign in to use this feature."); });
    return;
  }
  try {
    const [reqA, reqB, txA, txB, reviewSnap] = await Promise.all([
      getDocs(query(collection(db, "borrowRequests"), where("borrowerId", "==", user.uid))),
      getDocs(query(collection(db, "borrowRequests"), where("ownerId", "==", user.uid))),
      getDocs(query(collection(db, "transactions"), where("borrowerId", "==", user.uid))),
      getDocs(query(collection(db, "transactions"), where("ownerId", "==", user.uid))),
      getDocs(query(collection(db, "reviews"), where("revieweeId", "==", user.uid)))
    ]);
    const reqs = [...reqA.docs, ...reqB.docs].map(d => ({id:d.id,...d.data()}));
    notificationsList.innerHTML = reqs.length ? reqs.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)).slice(0,12).map(r => `<article class="record"><div><strong>${escapeHTML(r.itemName || "Borrow request")}</strong><p>Your request is ${escapeHTML(r.status || "pending")}.</p></div>${statusPill(r.status)}</article>`).join("") : emptyText("No notifications yet.");
    const txMap = new Map(); [...txA.docs,...txB.docs].forEach(d=>txMap.set(d.id,{id:d.id,...d.data()}));
    const txs = [...txMap.values()];
    const chatEligible = txs.filter(t=>["active","returned"].includes(t.status));
    chatLoans.innerHTML = chatEligible.length ? chatEligible.map(t=>`<article class="record"><div><strong>${escapeHTML(t.itemName || "Loan")}</strong><p>${t.status === "active" ? "Active loan" : "Returned loan"}</p></div><button class="small-btn" data-chat-tx="${escapeHTML(t.id)}">Open chat</button></article>`).join("") : emptyText("Chat appears after a loan is approved.");
    const myReviews = await getDocs(query(collection(db,"reviews"),where("reviewerId","==",user.uid)));
    const reviewData = myReviews.docs.map(d=>({id:d.id,...d.data()}));
    const reviewable = txs.filter(t=>t.status === "returned" && t.borrowerId === user.uid && !reviewData.some(r=>r.transactionId===t.id));
    reviewsList.innerHTML = [...reviewData.map(r=>`<article class="record"><div><strong>${escapeHTML(r.itemName || "Review")}</strong><p>${"⭐".repeat(Math.max(1,Math.min(5,Number(r.rating)||1)))} ${escapeHTML(r.comment || "")}</p></div></article>`), ...reviewable.map(t=>`<article class="record record-stack"><strong>Review ${escapeHTML(t.itemName || "returned item")}</strong><button class="small-btn" data-review-tx="${escapeHTML(t.id)}">Write review</button></article>`)].join("") || emptyText("Reviews can be added after returning an item.");
    if (ADMIN_EMAILS.map(x=>x.toLowerCase()).includes((user.email||"").toLowerCase()) && !ADMIN_EMAILS[0].startsWith("replace-with")) {
      const [allItemsSnap, usersSnap, allTxSnap] = await Promise.all([getDocs(collection(db,"items")), getDocs(collection(db,"users")), getDocs(collection(db,"transactions"))]);
      adminPanel.innerHTML = `<p><strong>Items:</strong> ${allItemsSnap.size} · <strong>Users:</strong> ${usersSnap.size} · <strong>Transactions:</strong> ${allTxSnap.size}</p>` + allItemsSnap.docs.map(d=>{const it=d.data();return `<article class="record"><div><strong>${escapeHTML(it.name||"Item")}</strong><p>Owner: ${escapeHTML(it.ownerEmail||it.ownerId||"unknown")}</p></div><button class="small-btn reject-btn" data-admin-delete-item="${escapeHTML(d.id)}">Delete item</button></article>`}).join("");
    } else adminPanel.innerHTML = emptyText("Admin access is not enabled for this account. Configure ADMIN_EMAILS in app.js and the rules, then publish both rulesets.");
  } catch (e) { console.error(e); [notificationsList,chatLoans,reviewsList,adminPanel].forEach(el=>{if(el)el.innerHTML=emptyText(errorMessage(e));}); }
}

document.getElementById("refreshExtrasBtn")?.addEventListener("click", loadExtras);
document.getElementById("chatLoans")?.addEventListener("click", async e=>{
  const b=e.target.closest("[data-chat-tx]"); if(!b)return;
  activeChatTransaction=b.dataset.chatTx; document.getElementById("chatPanel").hidden=false; await loadChatMessages();
});
async function loadChatMessages(){
  const user=auth.currentUser; if(!user||!activeChatTransaction)return;
  try{
    const txSnap=await getDoc(doc(db,"transactions",activeChatTransaction)); if(!txSnap.exists())throw new Error("Loan not found");
    const tx=txSnap.data(); if(![tx.ownerId,tx.borrowerId].includes(user.uid))throw new Error("You cannot access this chat.");
    const snap=await getDocs(query(collection(db,"transactions",activeChatTransaction,"messages")));
    const msgs=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.createdAt?.seconds||0)-(b.createdAt?.seconds||0));
    document.getElementById("chatMessages").innerHTML=msgs.map(m=>`<article class="record"><div><strong>${m.senderId===user.uid?"You":escapeHTML(m.senderEmail||"Other user")}</strong><p>${escapeHTML(m.text||"")}</p></div><small>${formatDate(m.createdAt)}</small></article>`).join("")||emptyText("Start the conversation about pickup, payment or return.");
  }catch(e){showMessage(errorMessage(e));}
}
document.getElementById("sendChatBtn")?.addEventListener("click",async()=>{
  const user=auth.currentUser,input=document.getElementById("chatMessageInput"),text=input.value.trim(); if(!user||!activeChatTransaction||!text)return;
  try{const txSnap=await getDoc(doc(db,"transactions",activeChatTransaction));if(!txSnap.exists())throw new Error("Loan not found");const tx=txSnap.data();if(![tx.ownerId,tx.borrowerId].includes(user.uid))throw new Error("Chat not allowed");await addDoc(collection(db,"transactions",activeChatTransaction,"messages"),{senderId:user.uid,senderEmail:user.email||"",text,createdAt:serverTimestamp()});input.value="";await loadChatMessages();}catch(e){showMessage(errorMessage(e));}
});
document.getElementById("reviewsList")?.addEventListener("click",async e=>{
 const b=e.target.closest("[data-review-tx]");if(!b)return;const user=auth.currentUser;if(!user)return;
 const rating=Number(prompt("Rate the lending experience from 1 to 5", "5"));if(!Number.isInteger(rating)||rating<1||rating>5){showMessage("Enter a rating from 1 to 5.");return;}
 const comment=prompt("Write a short review (optional)","")||"";
 try{const txSnap=await getDoc(doc(db,"transactions",b.dataset.reviewTx));if(!txSnap.exists())throw new Error("Loan not found");const tx=txSnap.data();if(tx.status!=="returned"||tx.borrowerId!==user.uid)throw new Error("Only the borrower can review after return.");await addDoc(collection(db,"reviews"),{transactionId:txSnap.id,itemId:tx.itemId,itemName:tx.itemName||"Borrowed item",reviewerId:user.uid,reviewerEmail:user.email||"",revieweeId:tx.ownerId,rating,comment,createdAt:serverTimestamp()});showMessage("Review submitted!");await loadExtras();}catch(err){showMessage(errorMessage(err));}
});
document.getElementById("adminPanel")?.addEventListener("click",async e=>{
 const b=e.target.closest("[data-admin-delete-item]");if(!b)return;const user=auth.currentUser;if(!user||!ADMIN_EMAILS.map(x=>x.toLowerCase()).includes((user.email||"").toLowerCase())||ADMIN_EMAILS[0].startsWith("replace-with")){showMessage("Admin access is not configured.");return;}
 if(!confirm("Delete this item listing? This does not delete loan history."))return;
 try{await deleteDoc(doc(db,"items",b.dataset.adminDeleteItem));showMessage("Item listing deleted.");await loadItems();await loadExtras();}catch(err){showMessage(errorMessage(err));}
});
