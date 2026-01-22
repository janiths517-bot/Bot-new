
const express = require('express');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const ytdl = require('ytdl-core');
const yts = require('yt-search');
const FileType = require('file-type');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

// Set the path for fluent-ffmpeg to find the ffmpeg executable
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const mongoose = require('mongoose');
const { sendTranslations } = require("./data/sendTranslations");

if (fs.existsSync('2nd_dev_config.env')) require('dotenv').config({ path: './2nd_dev_config.env' });

const { sms } = require("./msg");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    proto,
    prepareWAMessageMedia,
    downloadContentFromMessage,
    getContentType,
    generateWAMessageFromContent
} = require('@whiskeysockets/baileys');
const { title } = require('process');

// MongoDB Configuration Replce Your MongoDb Uri
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://test:test@cluster0.nq1hp2p.mongodb.net/?retryWrites=true&w=majority&appName=Cluster';

process.env.NODE_ENV = 'production';
process.env.PM2_NAME = 'JANI-md-session';

console.log('🚀 Auto Session Manager initialized with MongoDB Atlas');

// Configs
const footer = `*㋛ JANI MD BY Janith sathsara*`
const logo = `https://files.catbox.moe/84288h.jpg`;
const caption = `⏤ ͟͞ ❮❮ JANI-ℂ𝕆𝔻𝔼ℝ𝕊 ❯❯ ⏤JANI-ᴍᴅᵀᴹ ヤ`; 
const botName = 'JANI-MD-V3'
const mainSite = 'bots.srihub.store';
const apibase = 'https://api.srihub.store'
const apikey = `dew_OOnJzBbvdd9vAk9NOOMpRUGpQj8hwbERfugudGbN`;
const version = "v5"
const ownerName = "Janith sathsara"
const website = "bots.srihub.store"

const config = {
    // General Bot Settings
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['💚', '❤️','🩵','💛','💕'],
    BUTTON: 'true',

    // Message Auto-React Settings
    AUTO_REACT_MESSAGES: 'false',
    AUTO_REACT_MESSAGES_EMOJIS: ['👍', '❤️', '😂', '😮', '😢', '🙏'],

    // Newsletter Auto-React Settings
    AUTO_REACT_NEWSLETTERS: 'true',

    NEWSLETTER_JIDS: ['120363421416353845@newsletter','120363404091995336@newsletter','120363403558045457@newsletter',''],
    NEWSLETTER_REACT_EMOJIS: ['❤️', '💚', '🩷','🪽','🩵','💛','👽'],

    // OPTIMIZED Auto Session Management
    AUTO_SAVE_INTERVAL: 1800000,        // Auto-save every 5 minutes (300000 ms)
    AUTO_CLEANUP_INTERVAL: 1800000,    // Cleanup every 30 minutes
    AUTO_RECONNECT_INTERVAL: 300000,   // Check reconnection every 5 minutes
    AUTO_RESTORE_INTERVAL: 3600000,    // Auto-restore every 1 hour (3600000 ms)
    MONGODB_SYNC_INTERVAL: 1000000,    // Sync with MongoDB every 10 minutes
    MAX_SESSION_AGE: 2592000000,       // 30 days in milliseconds
    DISCONNECTED_CLEANUP_TIME: 900000, // 15 minutes for disconnected sessions (900000 ms)
    MAX_FAILED_ATTEMPTS: 3,            // Max failed reconnection attempts
    INITIAL_RESTORE_DELAY: 10000,      // Wait 10 seconds before initial restore (10000 ms)
    IMMEDIATE_DELETE_DELAY: 300000,    // Wait 5 minutes before deleting invalid sessions (300000 ms)

    // Command Settings
    PREFIX: '.',
    MAX_RETRIES: 3,

    // Group & Channel Settings
    NEWSLETTER_JID: '120363421416353845@newsletter',

    // File Paths
    ADMIN_LIST_PATH: './data/admin.json',
    NUMBER_LIST_PATH: './numbers.json',
    SESSION_STATUS_PATH: './session_status.json',
    SESSION_BASE_PATH: './session',

    // Owner Details
    OWNER_NUMBER: '94761427943',
};
 
// Session Management Maps
const activeSockets = new Map();
const socketCreationTime = new Map();
const disconnectionTime = new Map();
const sessionHealth = new Map();
const reconnectionAttempts = new Map();
const lastBackupTime = new Map();
const pendingSaves = new Map();
const restoringNumbers = new Set();
const sessionConnectionStatus = new Map();

// Auto-management intervals
let autoSaveInterval;
let autoCleanupInterval;
let autoReconnectInterval;
let autoRestoreInterval;
let mongoSyncInterval;

// MongoDB Connection
let mongoConnected = false;

// MongoDB Schemas
const sessionSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true, index: true },
    sessionData: { type: Object, required: true },
    status: { type: String, default: 'active', index: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
    health: { type: String, default: 'active' },
    initialMessagesSent: { type: Boolean, default: false }
});

const userConfigSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true, index: true },
    config: { type: Object, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Session = mongoose.model('Session', sessionSchema);
const UserConfig = mongoose.model('UserConfig', userConfigSchema);

// Initialize MongoDB Connection
async function initializeMongoDB() {
    try {
        if (mongoConnected) return true;

        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 30000,
            socketTimeoutMS: 45000,
        });

        mongoConnected = true;
        console.log('✅ MongoDB Atlas connected successfully');

        // Create indexes
        await Session.createIndexes();
        await UserConfig.createIndexes();

        return true;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        mongoConnected = false;
        
        // Retry connection after 5 seconds
        setTimeout(() => {
            initializeMongoDB();
        }, 5000);
        
        return false;
    }
}

// MongoDB Session Management Functions
async function saveSessionToMongoDB(number, sessionData) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        if (!isSessionActive(sanitizedNumber)) {
            console.log(`⏭️ Not saving inactive session to MongoDB: ${sanitizedNumber}`);
            return false;
        }

        await Session.findOneAndUpdate(
            { number: sanitizedNumber },
            {
                sessionData: sessionData,
                status: 'active',
                updatedAt: new Date(),
                lastActive: new Date(),
                health: sessionHealth.get(sanitizedNumber) || 'active'
            },
            { upsert: true, new: true }
        );

        console.log(`✅ Session saved to MongoDB: ${sanitizedNumber}`);
        return true;
    } catch (error) {
        console.error(`❌ MongoDB save failed for ${number}:`, error.message);
        pendingSaves.set(number, {
            data: sessionData,
            timestamp: Date.now()
        });
        return false;
    }
}

async function loadSessionFromMongoDB(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        
        const session = await Session.findOne({ 
            number: sanitizedNumber,
            status: { $ne: 'deleted' }
        });

        if (session) {
            console.log(`✅ Session loaded from MongoDB: ${sanitizedNumber}`);
            return session.sessionData;
        }

        return null;
    } catch (error) {
        console.error(`❌ MongoDB load failed for ${number}:`, error.message);
        return null;
    }
}

async function deleteSessionFromMongoDB(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        // Delete session
        await Session.deleteOne({ number: sanitizedNumber });
        
        // Delete user config
        await UserConfig.deleteOne({ number: sanitizedNumber });

        console.log(`🗑️ Session deleted from MongoDB: ${sanitizedNumber}`);
        return true;
    } catch (error) {
        console.error(`❌ MongoDB delete failed for ${number}:`, error.message);
        return false;
    }
}

async function getAllActiveSessionsFromMongoDB() {
    try {
        const sessions = await Session.find({ 
            status: 'active',
            health: { $ne: 'invalid' }
        });

        console.log(`📊 Found ${sessions.length} active sessions in MongoDB`);
        return sessions;
    } catch (error) {
        console.error('❌ Failed to get sessions from MongoDB:', error.message);
        return [];
    }
}

async function updateSessionStatusInMongoDB(number, status, health = null) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        const updateData = {
            status: status,
            updatedAt: new Date()
        };

        if (health) {
            updateData.health = health;
        }

        if (status === 'active') {
            updateData.lastActive = new Date();
        }

        await Session.findOneAndUpdate(
            { number: sanitizedNumber },
            updateData,
            { upsert: false }
        );

        console.log(`📝 Session status updated in MongoDB: ${sanitizedNumber} -> ${status}`);
        return true;
    } catch (error) {
        console.error(`❌ MongoDB status update failed for ${number}:`, error.message);
        return false;
    }
}

async function cleanupInactiveSessionsFromMongoDB() {
    try {
        // Delete sessions that are disconnected or invalid
        const result = await Session.deleteMany({
            $or: [
                { status: 'disconnected' },
                { status: 'invalid' },
                { status: 'failed' },
                { health: 'invalid' },
                { health: 'disconnected' }
            ]
        });

        console.log(`🧹 Cleaned ${result.deletedCount} inactive sessions from MongoDB`);
        return result.deletedCount;
    } catch (error) {
        console.error('❌ MongoDB cleanup failed:', error.message);
        return 0;
    }
}

async function getMongoSessionCount() {
    try {
        const count = await Session.countDocuments({ status: 'active' });
        return count;
    } catch (error) {
        console.error('❌ Failed to count MongoDB sessions:', error.message);
        return 0;
    }
}

// User Config MongoDB Functions
async function saveUserConfigToMongoDB(number, configData) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        await UserConfig.findOneAndUpdate(
            { number: sanitizedNumber },
            {
                config: configData,
                updatedAt: new Date()
            },
            { upsert: true, new: true }
        );

        console.log(`✅ User config saved to MongoDB: ${sanitizedNumber}`);
        return true;
    } catch (error) {
        console.error(`❌ MongoDB config save failed for ${number}:`, error.message);
        return false;
    }
}

async function loadUserConfigFromMongoDB(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        
        const userConfig = await UserConfig.findOne({ number: sanitizedNumber });

        if (userConfig) {
            console.log(`✅ User config loaded from MongoDB: ${sanitizedNumber}`);
            return userConfig.config;
        }

        return null;
    } catch (error) {
        console.error(`❌ MongoDB config load failed for ${number}:`, error.message);
        return null;
    }
}


// Create necessary directories
function initializeDirectories() {
    const dirs = [
        config.SESSION_BASE_PATH,
        './temp'
    ];

    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`📁 Created directory: ${dir}`);
        }
    });
}

initializeDirectories();

// **HELPER FUNCTIONS**

async function downloadAndSaveMedia(message, mediaType) {
    try {
        const stream = await downloadContentFromMessage(message, mediaType);
        let buffer = Buffer.from([]);

        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        return buffer;
    } catch (error) {
        console.error('Download Media Error:', error);
        throw error;
    }
}

// **SESSION MANAGEMENT**

function isSessionActive(number) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const health = sessionHealth.get(sanitizedNumber);
    const connectionStatus = sessionConnectionStatus.get(sanitizedNumber);
    const socket = activeSockets.get(sanitizedNumber);

    return (
        connectionStatus === 'open' &&
        health === 'active' &&
        socket &&
        socket.user &&
        !disconnectionTime.has(sanitizedNumber)
    );
}

async function saveSessionLocally(number, sessionData) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        if (!isSessionActive(sanitizedNumber)) {
            console.log(`⏭️ Skipping local save for inactive session: ${sanitizedNumber}`);
            return false;
        }

        const sessionPath = path.join(config.SESSION_BASE_PATH, `session_${sanitizedNumber}`);

        fs.ensureDirSync(sessionPath);

        fs.writeFileSync(
            path.join(sessionPath, 'creds.json'),
            JSON.stringify(sessionData, null, 2)
        );

        console.log(`💾 Active session saved locally: ${sanitizedNumber}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to save session locally for ${number}:`, error);
        return false;
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        // Try MongoDB
        const sessionData = await loadSessionFromMongoDB(sanitizedNumber);
        
        if (sessionData) {
            // Save to local for running bot
            await saveSessionLocally(sanitizedNumber, sessionData);
            console.log(`✅ Restored session from MongoDB: ${sanitizedNumber}`);
            return sessionData;
        }

        return null;
    } catch (error) {
        console.error(`❌ Session restore failed for ${number}:`, error.message);
        return null;
    }
}

async function deleteSessionImmediately(number) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');

    console.log(`🗑️ Immediately deleting inactive/invalid session: ${sanitizedNumber}`);

    // Delete local files
    const sessionPath = path.join(config.SESSION_BASE_PATH, `session_${sanitizedNumber}`);
    if (fs.existsSync(sessionPath)) {
        fs.removeSync(sessionPath);
        console.log(`🗑️ Deleted session directory: ${sanitizedNumber}`);
    }

    // Delete from MongoDB
    await deleteSessionFromMongoDB(sanitizedNumber);

    // Clear all references
    pendingSaves.delete(sanitizedNumber);
    sessionConnectionStatus.delete(sanitizedNumber);
    disconnectionTime.delete(sanitizedNumber);
    sessionHealth.delete(sanitizedNumber);
    reconnectionAttempts.delete(sanitizedNumber);
    socketCreationTime.delete(sanitizedNumber);
    lastBackupTime.delete(sanitizedNumber);
    restoringNumbers.delete(sanitizedNumber);
    activeSockets.delete(sanitizedNumber);

    await updateSessionStatus(sanitizedNumber, 'deleted', new Date().toISOString());

    console.log(`✅ Successfully deleted all data for inactive session: ${sanitizedNumber}`);
}

// **AUTO MANAGEMENT FUNCTIONS**

function initializeAutoManagement() {
    console.log('🔄 Starting optimized auto management with MongoDB...');

    // Initialize MongoDB
    initializeMongoDB().then(() => {
        // Start initial restore after MongoDB is connected
        setTimeout(async () => {
            console.log('🔄 Initial auto-restore on startup...');
            await autoRestoreAllSessions();
        }, config.INITIAL_RESTORE_DELAY);
    });

    autoSaveInterval = setInterval(async () => {
        console.log('💾 Auto-saving active sessions...');
        await autoSaveAllActiveSessions();
    }, config.AUTO_SAVE_INTERVAL);

    mongoSyncInterval = setInterval(async () => {
        console.log('🔄 Syncing active sessions with MongoDB...');
        await syncPendingSavesToMongoDB();
    }, config.MONGODB_SYNC_INTERVAL);

    autoCleanupInterval = setInterval(async () => {
        console.log('🧹 Auto-cleaning inactive sessions...');
        await autoCleanupInactiveSessions();
    }, config.AUTO_CLEANUP_INTERVAL);

    autoRestoreInterval = setInterval(async () => {
        console.log('🔄 Hourly auto-restore check...');
        await autoRestoreAllSessions();
    }, config.AUTO_RESTORE_INTERVAL);
}


async function syncPendingSavesToMongoDB() {
    if (pendingSaves.size === 0) {
        console.log('✅ No pending saves to sync with MongoDB');
        return;
    }

    console.log(`🔄 Syncing ${pendingSaves.size} pending saves to MongoDB...`);
    let successCount = 0;
    let failCount = 0;

    for (const [number, sessionInfo] of pendingSaves) {
        if (!isSessionActive(number)) {
            console.log(`⏭️ Session became inactive, skipping: ${number}`);
            pendingSaves.delete(number);
            continue;
        }

        try {
            const success = await saveSessionToMongoDB(number, sessionInfo.data);
            if (success) {
                pendingSaves.delete(number);
                successCount++;
            } else {
                failCount++;
            }
            await delay(500);
        } catch (error) {
            console.error(`❌ Failed to save ${number} to MongoDB:`, error.message);
            failCount++;
        }
    }

    console.log(`✅ MongoDB sync completed: ${successCount} saved, ${failCount} failed, ${pendingSaves.size} pending`);
}

async function autoSaveAllActiveSessions() {
    try {
        let savedCount = 0;
        let skippedCount = 0;

        for (const [number, socket] of activeSockets) {
            if (isSessionActive(number)) {
                const success = await autoSaveSession(number);
                if (success) {
                    savedCount++;
                } else {
                    skippedCount++;
                }
            } else {
                console.log(`⏭️ Skipping save for inactive session: ${number}`);
                skippedCount++;
                await deleteSessionImmediately(number);
            }
        }

        console.log(`✅ Auto-save completed: ${savedCount} active saved, ${skippedCount} skipped/deleted`);
    } catch (error) {
        console.error('❌ Auto-save all sessions failed:', error);
    }
}

async function autoSaveSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        if (!isSessionActive(sanitizedNumber)) {
            console.log(`⏭️ Not saving inactive session: ${sanitizedNumber}`);
            return false;
        }

        const sessionPath = path.join(config.SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        const credsPath = path.join(sessionPath, 'creds.json');

        if (fs.existsSync(credsPath)) {
            const fileContent = await fs.readFile(credsPath, 'utf8');
            const credData = JSON.parse(fileContent);

            // Save to MongoDB
            await saveSessionToMongoDB(sanitizedNumber, credData);
            
            // Update status
            await updateSessionStatusInMongoDB(sanitizedNumber, 'active', 'active');
            await updateSessionStatus(sanitizedNumber, 'active', new Date().toISOString());

            return true;
        }
        return false;
    } catch (error) {
        console.error(`❌ Failed to auto-save session for ${number}:`, error);
        return false;
    }
}

async function autoCleanupInactiveSessions() {
    try {
        const sessionStatus = await loadSessionStatus();
        let cleanedCount = 0;

        // Check local active sockets
        for (const [number, socket] of activeSockets) {
            const isActive = isSessionActive(number);
            const status = sessionStatus[number]?.status || 'unknown';
            const disconnectedTimeValue = disconnectionTime.get(number);

            const shouldDelete =
                !isActive ||
                (disconnectedTimeValue && (Date.now() - disconnectedTimeValue > config.DISCONNECTED_CLEANUP_TIME)) ||
                ['failed', 'invalid', 'max_attempts_reached', 'deleted', 'disconnected'].includes(status);

            if (shouldDelete) {
                await deleteSessionImmediately(number);
                cleanedCount++;
            }
        }

        // Clean MongoDB inactive sessions
        const mongoCleanedCount = await cleanupInactiveSessionsFromMongoDB();
        cleanedCount += mongoCleanedCount;

        console.log(`✅ Auto-cleanup completed: ${cleanedCount} inactive sessions cleaned`);
    } catch (error) {
        console.error('❌ Auto-cleanup failed:', error);
    }
}

async function autoRestoreAllSessions() {
    try {
        if (!mongoConnected) {
            console.log('⚠️ MongoDB not connected, skipping auto-restore');
            return { restored: [], failed: [] };
        }

        console.log('🔄 Starting auto-restore process from MongoDB...');
        const restoredSessions = [];
        const failedSessions = [];

        // Get all active sessions from MongoDB
        const mongoSessions = await getAllActiveSessionsFromMongoDB();

        for (const session of mongoSessions) {
            const number = session.number;

            if (activeSockets.has(number) || restoringNumbers.has(number)) {
                continue;
            }

            try {
                console.log(`🔄 Restoring session from MongoDB: ${number}`);
                restoringNumbers.add(number);

                // Save to local for running bot
                await saveSessionLocally(number, session.sessionData);

                const mockRes = {
                    headersSent: false,
                    send: () => { },
                    status: () => mockRes
                };

                await EmpirePair(number, mockRes);
                restoredSessions.push(number);

                await delay(3000);
            } catch (error) {
                console.error(`❌ Failed to restore session ${number}:`, error.message);
                failedSessions.push(number);
                restoringNumbers.delete(number);
                
                // Update status in MongoDB
                await updateSessionStatusInMongoDB(number, 'failed', 'disconnected');
            }
        }

        console.log(`✅ Auto-restore completed: ${restoredSessions.length} restored, ${failedSessions.length} failed`);

        if (restoredSessions.length > 0) {
            console.log(`✅ Restored sessions: ${restoredSessions.join(', ')}`);
        }

        if (failedSessions.length > 0) {
            console.log(`❌ Failed sessions: ${failedSessions.join(', ')}`);
        }

        return { restored: restoredSessions, failed: failedSessions };
    } catch (error) {
        console.error('❌ Auto-restore failed:', error);
        return { restored: [], failed: [] };
    }
}

async function updateSessionStatus(number, status, timestamp, extra = {}) {
    try {
        const sessionStatus = await loadSessionStatus();
        sessionStatus[number] = {
            status,
            timestamp,
            ...extra
        };
        await saveSessionStatus(sessionStatus);
    } catch (error) {
        console.error('❌ Failed to update session status:', error);
    }
}

async function loadSessionStatus() {
    try {
        if (fs.existsSync(config.SESSION_STATUS_PATH)) {
            return JSON.parse(fs.readFileSync(config.SESSION_STATUS_PATH, 'utf8'));
        }
        return {};
    } catch (error) {
        console.error('❌ Failed to load session status:', error);
        return {};
    }
}

async function saveSessionStatus(sessionStatus) {
    try {
        fs.writeFileSync(config.SESSION_STATUS_PATH, JSON.stringify(sessionStatus, null, 2));
    } catch (error) {
        console.error('❌ Failed to save session status:', error);
    }
}


function applyConfigSettings(loadedConfig) {
    if (loadedConfig.NEWSLETTER_JIDS) {
        config.NEWSLETTER_JIDS = loadedConfig.NEWSLETTER_JIDS;
    }
    if (loadedConfig.NEWSLETTER_REACT_EMOJIS) {
        config.NEWSLETTER_REACT_EMOJIS = loadedConfig.NEWSLETTER_REACT_EMOJIS;
    }
    if (loadedConfig.AUTO_REACT_NEWSLETTERS !== undefined) {
        config.AUTO_REACT_NEWSLETTERS = loadedConfig.AUTO_REACT_NEWSLETTERS;
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        if (!isSessionActive(sanitizedNumber)) {
            console.log(`⏭️ Not saving config for inactive session: ${sanitizedNumber}`);
            return;
        }

        // Save to MongoDB
        await saveUserConfigToMongoDB(sanitizedNumber, newConfig);
        
        console.log(`✅ Config updated in MongoDB: ${sanitizedNumber}`);
    } catch (error) {
        console.error('❌ Failed to update config:', error);
        throw error;
    }
}

// **HELPER FUNCTIONS**

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('❌ Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `${title}\n\n${content}\n\n${footer}`;
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

async function sendAdminConnectMessage(socket, number) {
    const admins = loadAdmins();

    const caption = formatMessage(
        '*JANI-MD Whatsapp Bot Connected*',
        `Connect - ${mainSite}\n\n📞 Number: ${number}\n🟢 Status: Auto-Connected\n⏰ Time: ${getSriLankaTimestamp()}`,
        `${footer}`
    );

    for (const admin of admins) {
        try {
            // 🔹 Add a check to ensure the socket connection is open before sending
            if (socket.ws.readyState !== 1) {
                console.warn(`⚠️ Skipping admin message to ${admin}: Connection is not open.`);
                continue; // Skip to the next admin if connection is closed
            }

            await socket.sendMessage(
                `${admin}@s.whatsapp.net`,
                {
                    image: { url: logo },
                    caption
                }
            );
        } catch (error) {
            console.error(`❌ Failed to send admin message to ${admin}:`, error);
        }
    }
}

async function handleUnknownContact(socket, number, messageJid) {
    return; // Do nothing
}

async function updateAboutStatus(socket) {
    const aboutStatus = 'JANI MD Whatsapp Bot Active 💦';
    try {
        await socket.updateProfileStatus(aboutStatus);
        console.log(`✅ Auto-updated About status`);
    } catch (error) {
        console.error('❌ Failed to update About status:', error);
    }
}


const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

const myquoted = {
    key: {
        remoteJid: 'status@broadcast',
        participant: '0@s.whatsapp.net',
        fromMe: false,
        id: createSerial(16).toUpperCase()
    },
    message: {
        contactMessage: {
            displayName: "JANI-MD",
            vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:JANI MD\nORG:JANI Coders;\nTEL;type=CELL;type=VOICE;waid=13135550002:13135550002\nEND:VCARD`,
            contextInfo: {
                stanzaId: createSerial(16).toUpperCase(),
                participant: "0@s.whatsapp.net",
                quotedMessage: {
                    conversation: "JANI AI"
                }
            }
        }
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
    status: 1,
    verifiedBizName: "Meta"
};

// **EVENT HANDLERS**

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;

        const isNewsletter = config.NEWSLETTER_JIDS.some(jid =>
            message.key.remoteJid === jid ||
            message.key.remoteJid?.includes(jid)
        );

        if (!isNewsletter || config.AUTO_REACT_NEWSLETTERS !== 'true') return;

        try {
            const randomEmoji = config.NEWSLETTER_REACT_EMOJIS[
                Math.floor(Math.random() * config.NEWSLETTER_REACT_EMOJIS.length)
            ];
            const messageId = message.newsletterServerId;

            if (!messageId) {
                console.warn('⚠️ No valid newsletterServerId found for newsletter:', message.key.remoteJid);
                return;
            }

            let retries = config.MAX_RETRIES;
            while (retries > 0) {
                try {
                    await socket.newsletterReactMessage(
                        message.key.remoteJid,
                        messageId.toString(),
                        randomEmoji
                    );
                    console.log(`✅ Auto-reacted to newsletter ${message.key.remoteJid}: ${randomEmoji}`);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`⚠️ Newsletter reaction failed for ${message.key.remoteJid}, retries: ${retries}`);
                    if (retries === 0) {
                        console.error(`❌ Failed to react to newsletter ${message.key.remoteJid}:`, error.message);
                    }
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
        } catch (error) {
            console.error('❌ Newsletter reaction error:', error);
        }
    });
}

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const userConfig = socket.userConfig || config;
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;

        try {
            if (userConfig.AUTO_RECORDING === 'true' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (userConfig.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        console.log(`👁️ Auto-viewed status for ${socket.user.id.split(':')[0]}`);
                        break;
                    } catch (error) {
                        retries--;
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }

            if (userConfig.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = (userConfig.AUTO_LIKE_EMOJI || config.AUTO_LIKE_EMOJI)[Math.floor(Math.random() * (userConfig.AUTO_LIKE_EMOJI || config.AUTO_LIKE_EMOJI).length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(message.key.remoteJid, { 
                            react: { text: randomEmoji, key: message.key } 
                        }, { statusJidList: [message.key.participant] });
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status for ${socket.user.id.split(':')[0]}, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

async function setupStatusSavers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];

        try {
            // ==== Detect reply to status from anyone ====
            if (message.message?.extendedTextMessage?.contextInfo) {
                const replyText = message.message.extendedTextMessage.text?.trim().toLowerCase();
                const quotedInfo = message.message.extendedTextMessage.contextInfo;

                // Check if reply matches translations & is to a status
                if (
                    sendTranslations.includes(replyText) &&
                    quotedInfo?.participant?.endsWith('@s.whatsapp.net') &&
                    quotedInfo?.remoteJid === "status@broadcast"
                ) {
                    const senderJid = message.key?.remoteJid;
                    if (!senderJid || !senderJid.includes('@')) return;

                    const quotedMsg = quotedInfo.quotedMessage;
                    const originalMessageId = quotedInfo.stanzaId;

                    if (!quotedMsg || !originalMessageId) {
                        console.warn("Skipping send: Missing quotedMsg or stanzaId");
                        return;
                    }

                    const mediaType = Object.keys(quotedMsg || {})[0];
                    if (!mediaType || !quotedMsg[mediaType]) return;

                    // Extract caption
                    let statusCaption = "";
                    if (quotedMsg[mediaType]?.caption) {
                        statusCaption = quotedMsg[mediaType].caption;
                    } else if (quotedMsg?.conversation) {
                        statusCaption = quotedMsg.conversation;
                    }

                    // Download media
                    const stream = await downloadContentFromMessage(
                        quotedMsg[mediaType],
                        mediaType.replace("Message", "")
                    );
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                    const savetex = '*JANI-MD-STATUS-SAVER*'
                    // Send via bot
                    if (mediaType === "imageMessage") {
                        await socket.sendMessage(senderJid, { image: buffer, caption: `${savetex}\n\n${statusCaption || ""}` });
                    } else if (mediaType === "videoMessage") {
                        await socket.sendMessage(senderJid, { video: buffer, caption: `${savetex}\n\n${statusCaption || ""}` });
                    } else if (mediaType === "audioMessage") {
                        await socket.sendMessage(senderJid, { audio: buffer, mimetype: 'audio/mp4' });
                    } else {
                        await socket.sendMessage(senderJid, { text: `${savetex}\n\n${statusCaption || ""}` });
                    }

                    console.log(`✅ Status from ${quotedInfo.participant} saved & sent to ${senderJid}`);
                }
            }
        } catch (error) {
            console.error('Status save handler error:', error);
        }
    });
}



// **COMMAND HANDLERS**

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const userConfig = socket.userConfig || config;
        const msg = messages[0];
        if (!msg || !msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const type = getContentType(msg.message);
        if (!msg.message) return;
        msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;

        const from = msg.key.remoteJid;
        const sender = from;
        const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
        const senderNumber = (nowsender || '').split('@')[0];
        const developers = `${config.OWNER_NUMBER}`;
        const botNumber = socket.user.id.split(':')[0];
        const isbot = botNumber.includes(senderNumber);
        const isOwner = isbot ? isbot : developers.includes(senderNumber);
        const isGroup = from.endsWith("@g.us");
        let isAdmins = false;
        if (isGroup) {
            const groupMetadata = await socket.groupMetadata(from);
            const groupAdmins = groupMetadata.participants.filter(p => p.admin).map(p => p.id);
            isAdmins = groupAdmins.includes(nowsender);
        }
        const pushname = msg.pushName || 'User';
        const m = sms(socket, msg);

        const quoted =
        type == "extendedTextMessage" &&
        msg.message.extendedTextMessage.contextInfo != null
        ? msg.message.extendedTextMessage.contextInfo.quotedMessage || []
        : []
        let body = (type === 'conversation') ? msg.message.conversation 
        : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage') 
        ? msg.message.extendedTextMessage.text 
        : (type == 'interactiveResponseMessage') 
        ? msg.message.interactiveResponseMessage?.nativeFlowResponseMessage 
        && JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id 
        : (type == 'templateButtonReplyMessage') 
        ? msg.message.templateButtonReplyMessage?.selectedId 
        : (type === 'extendedTextMessage') 
        ? msg.message.extendedTextMessage.text 
        : (type == 'imageMessage') && msg.message.imageMessage.caption 
        ? msg.message.imageMessage.caption 
        : (type == 'videoMessage') && msg.message.videoMessage.caption 
        ? msg.message.videoMessage.caption 
        : (type == 'buttonsResponseMessage') 
        ? msg.message.buttonsResponseMessage?.selectedButtonId 
        : (type == 'listResponseMessage') 
        ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
        : (type == 'messageContextInfo') 
        ? (msg.message.buttonsResponseMessage?.selectedButtonId 
            || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
            || msg.text) 
            : (type === 'viewOnceMessage') 
            ? msg.message[type]?.message[getContentType(msg.message[type].message)] 
            : (type === "viewOnceMessageV2") 
            ? (msg.msg.message.imageMessage?.caption || msg.msg.message.videoMessage?.caption || "") 
            : '';
            body = String(body || '');

        const prefix = userConfig.PREFIX || config.PREFIX || '.';
        const isCmd = body && body.startsWith && body.startsWith(prefix);
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : null;
        const args = body.trim().split(/ +/).slice(1);
        const reply = (text) => socket.sendMessage(m.key.remoteJid, { text }, { quoted: msg });

        // New: Auto-react to non-command messages
        if (userConfig.AUTO_REACT_MESSAGES === 'true' && !isCmd && !msg.key.fromMe) {
            try {
                const emojis = userConfig.AUTO_REACT_MESSAGES_EMOJIS || config.AUTO_REACT_MESSAGES_EMOJIS;
                if (emojis && emojis.length > 0) {
                    // Add a small delay to make it feel more natural
                    await delay(500); 
                    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                    await socket.sendMessage(from, {
                        react: {
                            text: randomEmoji,
                            key: msg.key
                        }
                    });
                }
            } catch (reactError) {
                console.error(`❌ Auto-react to message failed for ${number}:`, reactError);
            }
        }

        const contextInfo = {
            mentionedJid: [m.sender],
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '120363421416353845@newsletter',
                newsletterName: '⏤ ͟͞ ❮❮ JANI-ℂ𝕆𝔻𝔼ℝ𝕊 ❯❯ ⏤JANI-ᴍᴅᵀᴹ ヤ',
                serverMessageId: 143
            }
        }; 
        const contextInfo2 = {
            mentionedJid: [m.sender],
            forwardingScore: 999,
            isForwarded: true
        };
        if (!command) return;

        try {
            switch (command) {

case 'fake': {
    await socket.sendMessage(from, {
        text: 'This is a test message with a custom quote.',
    }, { quoted: myquoted });
    break;
}

case "online":
case "ranuonline":
case "onlinemembers":
case "onlinep":
case "onlinepeoples":
case "active": {
    try {
        // Check if the command is used in a group
        if (!isGroup) return reply("*❌ This command can only be used in a group!*");

        // Check if user is either creator or admin
        if (!isOwner && !isAdmins && !msg.key.fromMe) {
            return reply("🚫 *Owner & Admins Only Command!*");
        }

        // Inform user that we're checking
        await reply("🔄 Scanning for online members... This may take 15-20 seconds.");

        const onlineMembers = new Set();
        const groupData = await socket.groupMetadata(from);
        const presencePromises = [];

        // Request presence updates for all participants
        for (const participant of groupData.participants) {
            presencePromises.push(
                socket.presenceSubscribe(participant.id)
                    .then(() => {
                        // Additional check for better detection
                        return socket.sendPresenceUpdate('composing', participant.id);
                    })
            );
        }

        await Promise.all(presencePromises);

        // Presence update handler
        const presenceHandler = (json) => {
            for (const id in json.presences) {
                const presence = json.presences[id]?.lastKnownPresence;
                // Check all possible online states
                if (['available', 'composing', 'recording', 'online'].includes(presence)) {
                    onlineMembers.add(id);
                }
            }
        };

        socket.ev.on('presence.update', presenceHandler);

        // Set a timeout to gather presence data
        setTimeout(async () => {
            socket.ev.off('presence.update', presenceHandler);

            if (onlineMembers.size === 0) {
                return reply("⚠️ Couldn't detect any online members. They might be hiding their presence.");
            }

            const onlineArray = Array.from(onlineMembers);
            const onlineList = onlineArray.map((member, index) =>
                `${index + 1}. @${member.split('@')[0]}`
            ).join('\n');

            const message = `🟢 *Online Members* (${onlineArray.length}/${groupData.participants.length}):\n\n${onlineList}\n\n${footer}`;

            await socket.sendMessage(from, {
                text: message,
                mentions: onlineArray
            }, { quoted: myquoted });
        }, 20000); // Wait for 20 seconds

    } catch (e) {
        console.error("Error in online command:", e);
        reply(`An error occurred: ${e.message}`);
    }
    break;
}

case 'csong': {
    try {
        if (args.length < 2) {
            return reply("⚠️ Use format:\n.csong <channel JID> <song name>\n\nExample:\n.csong 1203630xxxxx@newsletter Shape of You");
        }

        const targetJid = args[0];
        const songName = args.slice(1).join(" ");

        if (!targetJid || !targetJid.endsWith("@newsletter")) {
            return reply("❌ Invalid channel JID! It should end with @newsletter");
        }
        
        if (!songName) return reply("⚠️ Please provide a song name.");

        await reply(`Searching for "${songName}"...`);

        const search = await yts(songName);
        if (!search.videos.length) {
            return reply("❌ Song not found.");
        }

        const videoInfo = search.videos[0];
        const ytUrl = videoInfo.url;

        const api = `${apibase}/download/ytmp3?url=${ytUrl}&apikey=${apikey}`;
        const { data: apiRes } = await axios.get(api);

        if (!apiRes?.status || !apiRes.result?.download_url) {
            return reply("❌ Song not found or API error.");
        }

        let channelname = targetJid;
        try {
            const metadata = await socket.newsletterMetadata("jid", targetJid);
            if (metadata?.name) {
                channelname = metadata.name;
            }
        } catch (err) {
            console.error("Newsletter metadata error:", err);
        }
        const result = apiRes.result;
        const dlUrl = result.download_url;

        const caption = `☘️ ᴛɪᴛʟᴇ : ${videoInfo.title} 🙇‍♂️🫀🎧

❒ *🎭 Vɪᴇᴡꜱ :* ${videoInfo.views}
❒ *🫟 Channel*: ${videoInfo.author.name}
❒ *⏱️ Dᴜʀᴀᴛɪᴏɴ :* ${videoInfo.timestamp}
❒ *📅 Rᴇʟᴇᴀꜱᴇ Dᴀᴛᴇ :* ${videoInfo.ago}

*00:00 ───●────────── ${videoInfo.timestamp}*

* *ලස්සන රියැක්ට් ඕනී ...💗😽🍃*

> *${channelname}*`;

        // Send details + image to channel
        await socket.sendMessage(targetJid, {
            image: { url: result.thumbnail },
            caption: caption
        }, { quoted: myquoted });

        // Convert to voice (.opus)
        const tempPath = path.join(__dirname, `temp/${Date.now()}.mp3`);
        const voicePath = path.join(__dirname, `temp/${Date.now()}.opus`);

        const audioRes = await axios({ url: dlUrl, responseType: 'arraybuffer' });
        fs.writeFileSync(tempPath, audioRes.data);

        await new Promise((resolve, reject) => {
            ffmpeg(tempPath)
                .audioCodec("libopus")
                .format("opus")
                .audioBitrate("64k")
                .save(voicePath)
                .on("end", resolve)
                .on("error", reject);
        });

        const voiceBuffer = fs.readFileSync(voicePath);
        const durationSeconds = videoInfo.seconds;

        // SEND VOICE WITH DURATION
        await socket.sendMessage(targetJid, {
            audio: voiceBuffer,
            mimetype: "audio/ogg; codecs=opus",
            ptt: true,
            seconds: durationSeconds
        }, { quoted: myquoted });

        // Clean temp files
        fs.unlinkSync(tempPath);
        fs.unlinkSync(voicePath);

        reply(`*✅ Song sent successfully*\n\n*🎧 Song Title*: ${videoInfo.title}\n*🔖 Channel JID*: ${targetJid}`);

    } catch (e) {
        console.error(e);
        reply("*ඇතැම් දෝෂයකි! පසුව නැවත උත්සහ කරන්න.*");
    }
    break;
}

case 'alive': {
    const useButton = userConfig.BUTTON === 'true';
    const ownerName = socket.user.name || 'Janith sathsara';
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    const time = moment().tz('Asia/Colombo').format('HH:mm:ss');
    const date = moment().format('DD/MM/YYYY');

    const captionText = `👋 *HI*, *${pushname}* 
    
*╭─「 ᴅᴀᴛᴇ ɪɴꜰᴏʀᴍᴀᴛɪᴏɴ 」*
*│*📅 \`Date\` : ${date}      
*│*🕒 \`Time\` : ${time}
*╰──────────●●►*

*╭─「 ꜱᴛᴀᴛᴜꜱ ᴅᴇᴛᴀɪʟꜱ 」*
*│*👤 \`User\` : ${pushname}
*│*🧑‍💻 \`Owner\` : ${ownerName}
*│*✒️ \`Prefix\` : ${prefix}
*│*🧬 \`Version\` : ${version}
*│*📟 \`Uptime\` : ${hours}h ${minutes}m ${seconds}s
*╰──────────●●►*

*╭─「 ʙᴏᴛ ᴅᴇᴘʟᴏʏ 」*
*│*🤖 \`Deploy\` : ${website}
*╰──────────●●►*

${footer}`;
    // ✅ Send reaction to the user's command message
    await socket.sendMessage(m.chat, {
        react: {
            text: '☣️',       // The emoji to react with
            key: msg.key     // The message to react to
        }
    });
    if (useButton) {
    await socket.sendMessage(m.chat, {
        buttons: [
            {
                buttonId: 'action',
                buttonText: {
                    displayText: '📂 Menu Options'
                },
                type: 4,
                nativeFlowInfo: {
                    name: 'single_select',
                    paramsJson: JSON.stringify({
                        title: 'Click Here ❏',
                        sections: [
                            {
                                title: `${caption}`,
                                highlight_label: '',
                                rows: [
                                    {
                                        title: 'Menu',
                                        description: 'Get All Commands',
                                        id: `${prefix}menu`,
                                    },
                                    {
                                        title: 'Ping',
                                        description: 'Get Bot Speed',
                                        id: `${prefix}ping`,
                                    },
                                ],
                            },
                        ],
                    }),
                },
            },
        ],
        headerType: 1,
        image: { url: logo },
        caption: `${captionText}`,
        contextInfo: contextInfo2
    }, { quoted: myquoted });
    } else {
        await socket.sendMessage(m.chat, { 
    image: { url: logo },
    caption: captionText,
    contextInfo: contextInfo
},{ quoted: myquoted });

}
break;
}


// Menu Command - shows all commands in a button menu or text format - Last Update 2025-August-14
case 'list':
case 'pannel':
case 'menu': {
    const useButton = userConfig.BUTTON === 'true';
    // React to the menu command
    await socket.sendMessage(m.chat, {
        react: {
            text: '📜',
            key: msg.key
        }
    });

    // Commands list grouped by category
    const commandsInfo = {
        download: [
            { name: 'song', description: 'Download Songs' },
            { name: 'video', description: 'Download Videos'},
            { name: 'tiktok', description: 'Download TikTok video' },
            { name: 'img', description: 'Download Images' },
            { name: 'fb', description: 'Download Facebook video' },
            { name: 'ig', description: 'Download Instagram video' },
            { name: 'ts', description: 'Search TikTok videos' },
            { name: 'yts', description: 'Search YouTube videos' },
            { name: 'xvdl', description: 'Download Xvideos' },
            { name: 'ph', description: 'Download Pornhub videos' },
        ],
        main: [
            { name: 'alive', description: 'Show bot status' },
            { name: 'menu', description: 'Show all commands' },
            { name: 'ping', description: 'Get bot speed' },
            { name: 'freebot', description: 'Setup Free Bot' },
            { name: 'owner', description: 'Contact Bot Owner' },
            { name: 'getdp', description: 'Get Profile Picture' },
            { name: 'logo', description: 'Create Logo' },
            { name: 'fancy', description: 'View Fancy Text' },
            { name: 'winfo', description: 'Get User Profile Picture' },
            { name: 'cid', description: 'Get Channel ID' },
        ],
        owner: [
            { name: 'deleteme', description: 'Delete your session' },
            { name: 'fc', description: 'Follow newsletter channel' },
            { name: 'set', description: 'Set Setting Using Env' },
            { name: 'setting', description: 'Setup YouOwn Setting' },
            { name: 'jid', description: 'Get JID of a number' },
        ],
        group: [
            { name: 'bomb', description: 'Send Bomb Message' },
        ],
         ai: [
            { name: 'aiimg', description: 'Generate AI Image' },
        ],
    };

    // Build sections for button menu
    const sections = Object.entries(commandsInfo).map(([category, cmds]) => ({
        title: category.toUpperCase() + ' CMD',
        rows: cmds.map(cmd => ({
            title: cmd.name,
            description: cmd.description,
            id: prefix + cmd.name,
        })),
    }));

    const ownerName = socket.user.name || 'Hansa Dewmina';
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    // Menu captions
    const menuCaption = `🤩 *Hello ${pushname}*
> WELCOME TO ${botName} 🪀

*╭─「 ꜱᴛᴀᴛᴜꜱ ᴅᴇᴛᴀɪʟꜱ 」*
*│*👤 \`User\` : ${pushname}
*│*🧑‍💻 \`Owner\` : ${ownerName}
*│*✒️ \`Prefix\` : ${prefix}
*│*🧬 \`Version\` : ${version}
*│*📟 \`Uptime\` : ${hours}h ${minutes}m ${seconds}s
*╰──────────●●►*

${footer}`;
    const menuCaption2 = `🤩 *Hello ${pushname}*
> WELCOME TO ${botName} 🪀

*╭─「 ꜱᴛᴀᴛᴜꜱ ᴅᴇᴛᴀɪʟꜱ 」*
*│*👤 \`User\` : ${pushname}
*│*🧑‍💻 \`Owner\` : ${ownerName}
*│*✒️ \`Prefix\` : ${prefix}
*│*🧬 \`Version\` : ${version}
*│*📟 \`Uptime\` : ${hours}h ${minutes}m ${seconds}s
*╰──────────●●►*`;

    // Button menu
    if (useButton) {
        await socket.sendMessage(from, {
            image: { url: logo },
            caption: menuCaption,
            buttons: [
                {
                    buttonId: 'action',
                    buttonText: { displayText: '📂 Menu Options' },
                    type: 4,
                    nativeFlowInfo: {
                        name: 'single_select',
                        paramsJson: JSON.stringify({
                            title: 'Commands Menu ❏',
                            sections: sections,
                        }),
                    },
                },
            ],
            headerType: 1,
            viewOnce: true,
            contextInfo: contextInfo2
        }, { quoted: myquoted });

    // Normal image + caption menu
    } else {
        // Build plain text list of commands grouped by category
        let fullMenu = `${menuCaption2}`;
        for (const [category, cmds] of Object.entries(commandsInfo)) {
            fullMenu += `\n> ${category.toUpperCase()} COMMANDS\n`;
            fullMenu += `*╭──────────●●►*\n`;
            fullMenu += cmds.map(c => `*│*❯❯◦ ${c.name}`).join('\n');
            fullMenu += `\n*╰───────────●●►*`;
        }

        await socket.sendMessage(m.chat, { 
            image: { url: logo }, 
            caption: fullMenu+`\n\n${footer}`, 
            contextInfo 
        }, { quoted: myquoted });
    }

    break;
}



// Logo Maker Command - Button Selection
case 'logo': {
    const useButton = userConfig.BUTTON === 'true';
    const q = args.join(" ");
    if (!q || q.trim() === '') {
        return await socket.sendMessage(sender, { text: '*`Need a name for logo`*' });
    }

    await socket.sendMessage(sender, { react: { text: '⬆️', key: msg.key } });

    const list = require('./data/logo.json'); // JSON with all 50 logo styles

    const rows = list.map(v => ({
        title: v.name,
        description: 'Tap to generate logo',
        id: `${prefix}dllogo ${encodeURIComponent(v.url)} ${encodeURIComponent(q)}` // pass URL and text
    }));

    const buttonMessage = {
        buttons: [
            {
                buttonId: 'action',
                buttonText: { displayText: '🎨 Select Text Effect' },
                type: 4,
                nativeFlowInfo: {
                    name: 'single_select',
                    paramsJson: JSON.stringify({
                        title: 'Available Text Effects',
                        sections: [
                            {
                                title: 'Choose your logo style',
                                rows
                            }
                        ]
                    })
                }
            }
        ],
        headerType: 1,
        viewOnce: true,
        caption: `❏ *LOGO MAKER*\nReply a style to generate a logo for: *${q}*`,
        image: { url: logo },
    };
    if(useButton){
    await socket.sendMessage(from, buttonMessage, { quoted: msg });

} else {

    await socket.sendMessage(sender, { react: { text: '⬆️', key: msg.key } });

    let messageText = `🔢 Reply with the number for the *${q}* logo:\n\n`;

    list.forEach((v, i) => {
        messageText += `${i + 1} │❯❯◦ ${v.name}\n`;
    });

    const fetchLogoUrl = async (url, name) => {
        try {
            const response = await axios.get(`https://api-pink-venom.vercel.app/api/logo`, {
                params: { url, name }
            });
            return response.data.result.download_url;
        } catch (error) {
            console.error("Error fetching logo:", error);
            return null;
        }
    };

    messageText += `\n*Reply with a number (1-${list.length})*`;

    const sentMessage = await socket.sendMessage(from, { 
        image: { url: logo },
        caption: messageText }, 
        { quoted: msg });

    // Listen for user's reply
    const handler = async ({ messages }) => {
        const message = messages[0];
        if (!message.message?.extendedTextMessage) return;

        const replyText = message.message.extendedTextMessage.text.trim();
        const context = message.message.extendedTextMessage.contextInfo;

        // Only respond if replying to our menu message
        if (context?.stanzaId !== sentMessage.key.id) return;

        const index = parseInt(replyText);
        if (isNaN(index) || index < 1 || index > list.length) {
            return await socket.sendMessage(from, { text: `❌ Invalid number! Please reply with 1-${list.length}` }, { quoted: message });
        }

        const logo = list[index - 1];

        // Fetch logo using your helper
        const logoUrl = await fetchLogoUrl(logo.url, q);
        if (!logoUrl) {
            return await socket.sendMessage(from, { text: `❌ Failed to generate logo.` }, { quoted: message });
        }

        await socket.sendMessage(from, {
            image: { url: logoUrl },
            caption: `✨ Here’s your *${q}* logo\n\n${footer}`
        }, { quoted: message });

        // Remove listener after first valid reply
        socket.ev.off('messages.upsert', handler);
    };

    socket.ev.on('messages.upsert', handler);
        
}
    break;
}

// DLL Logo - Download the logo after selection
case 'dllogo': {
    if (args.length < 2) return reply("❌ Usage: dllogo <URL> <text>");

    const [url, ...nameParts] = args;
    const text = decodeURIComponent(nameParts.join(" "));
    const fetchLogoUrl = async (url, name) => {
        try {
            const response = await axios.get(`https://api-pink-venom.vercel.app/api/logo`, {
                params: { url, name }
            });
            return response.data.result.download_url;
        } catch (error) {
            console.error("Error fetching logo:", error);
            return null;
        }
    };
    try {
        const logoUrl = await fetchLogoUrl(decodeURIComponent(url), text);
        if (!logoUrl) return reply("❌ Failed to generate logo.");

        await socket.sendMessage(from, {
            image: { url: logoUrl },
            caption: `✨ Here’s your logo for *${text}*\n${config.CAPTION}`
        }, { quoted: msg });

    } catch (e) {
        console.log('Logo Download Error:', e);
        await socket.sendMessage(from, { text: `❌ Error:\n${e.message}` }, { quoted: msg });
    }
    break;
}


case 'cinfo':
case 'channelinfo':
case 'cid': {
    try {
        // 🔹 Extract query text from message
        let q = msg.message?.conversation?.split(" ")[1] || 
                msg.message?.extendedTextMessage?.text?.split(" ")[1];

        if (!q) return await socket.sendMessage(sender, { text: "❎ Please provide a WhatsApp Channel link.\n\nUsage: .cid <link>" });

        // 🔹 Extract Channel invite ID from link (flexible regex)
        const match = q.match(/https?:\/\/(www\.)?whatsapp\.com\/channel\/([\w-]+)/i);
        if (!match) return await socket.sendMessage(sender, { text: "⚠️ Invalid channel link!" });

        const inviteId = match[2];

        // 🔹 Fetch Channel Metadata
        let metadata;
        try {
            metadata = await socket.newsletterMetadata("invite", inviteId);
        } catch (err) {
            console.error("❌ Failed to fetch metadata via invite:", err);
            return await socket.sendMessage(sender, { text: "⚠️ Could not fetch channel metadata. Maybe the link is private or invalid." });
        }

        if (!metadata || !metadata.id) {
            return await socket.sendMessage(sender, { text: "❌ Channel not found or inaccessible." });
        }

        // 🔹 Prepare preview image
        let previewUrl = metadata.preview
            ? metadata.preview.startsWith("http") 
                ? metadata.preview 
                : `https://pps.whatsapp.net${metadata.preview}`
            : "https://telegra.ph/file/4cc2712eaba1c5c1488d3.jpg"; // default image

        // 🔹 Format followers and creation date
        const followers = metadata.subscribers?.toLocaleString() || "Unknown";
        const createdDate = metadata.creation_time 
            ? new Date(metadata.creation_time * 1000).toLocaleString("id-ID", { dateStyle: 'medium', timeStyle: 'short' })
            : "Unknown";

        // 🔹 Format message
        const infoMsg = `*🚨 JANI MD Channel Info 🚨*\n\n`
                      +`🆔 ID: ${metadata.id}\n`
                      +`📌 Name: ${metadata.name || "Unknown"}\n`
                      +`📝 Description: ${metadata.desc?.toString() || "No description"}\n`
                      +`👥 Followers: ${followers}\n`
                      +`📅 Created: ${createdDate}\n\n`
                      +`${footer}`;
        // 🔹 Send message with preview image
        await socket.sendMessage(sender, {
            image: { url: previewUrl },
            caption: infoMsg,
            ...(contextInfo ? { contextInfo } : {})
        }, { quoted: m });

    } catch (e) {
        console.error("❌ CID Command Error:", e);
        await socket.sendMessage(sender, { text: "⚠️ Error fetching channel details." });
    }
    break;
}

case 'follow':
case 'followchannel': {
    try {
        if (!args[0]) {
            return await socket.sendMessage(sender, {
                text: '*❌ Please provide a channel URL or JID*\n\n' +
                      '*Usage:*\n' +
                      '• .follow <channel_url>\n' +
                      '• .follow <channel_jid>\n\n' +
                      '*Example:*\n' +
                      '• .follow https://whatsapp.com/channel/0029Vb6Hil8CcW4mKCBklN1P\n' +
                      '• .follow 120363404091995336@newsletter'
            }, { quoted: myquoted });
        }

        const input = args.join(' ').trim();
        let channelJid = '';

        // Check if input is a URL or JID
        if (input.includes('whatsapp.com/channel/')) {
            // Extract channel code from URL
            const channelCodeMatch = input.match(/channel\/([a-zA-Z0-9]+)/);
            if (!channelCodeMatch) {
                return await socket.sendMessage(sender, {
                    text: '*❌ Invalid channel URL format*'
                }, { quoted: myquoted });
            }
            // Convert to potential JID
            channelJid = `${channelCodeMatch[1]}@newsletter`;
        } else if (input.includes('@newsletter')) {
            channelJid = input;
        } else {
            // Assume it's a channel code and add newsletter suffix
            channelJid = `${input}@newsletter`;
        }

        await socket.sendMessage(sender, { react: { text: '➕', key: msg.key } });

        // Try to follow the channel
        try {
            await socket.newsletterFollow(channelJid);
            
            // Add to config if owner
            if (isOwner(sender)) {
                const userConfig = (await loadUserConfigFromMongoDB(number)) || { ...config };
                if (!userConfig.NEWSLETTER_JIDS.includes(channelJid)) {
                    userConfig.NEWSLETTER_JIDS.push(channelJid);
                    
                    // Update global config as well for consistency if needed
                    config.NEWSLETTER_JIDS = userConfig.NEWSLETTER_JIDS;
                    await updateUserConfig(number, userConfig);
                }
            }

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
            
            await socket.sendMessage(sender, {
                image: { url: logo },
                caption: formatMessage(
                    '✅ CHANNEL FOLLOWED',
                    `Successfully followed channel!\n\n` +
                    `*Channel JID:* ${channelJid}\n` +
                    `*Auto-React:* ${config.AUTO_REACT_NEWSLETTERS === 'true' ? '✅ Enabled' : '❌ Disabled'}\n` +
                    (isOwner(sender) ? `*Added to auto-react list:* ✅` : ''),
                    'JANI 𝐌𝐃 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓'
                )
            }, { quoted: myquoted });

        } catch (error) {
            console.error('Follow error:', error);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            
            let errorMessage = 'Failed to follow channel';
            if (error.message.includes('not found')) {
                errorMessage = 'Channel not found or invalid JID';
            } else if (error.message.includes('already')) {
                errorMessage = 'Already following this channel';
            }
            
            await socket.sendMessage(sender, {
                text: `*❌ ${errorMessage}*\n\nTried JID: ${channelJid}`
            }, { quoted: myquoted });
        }

    } catch (error) {
        console.error('❌ Follow command error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ Error:* ${error.message || 'Failed to follow channel'}`
        }, { quoted: myquoted });
    }
    break;
}

case 'unfollow':
case 'unfollowchannel': {
    try {
        if (!args[0]) {
            return await socket.sendMessage(sender, {
                text: '*❌ Please provide a channel URL or JID*\n\n' +
                      '*Usage:*\n' +
                      '• .unfollow <channel_url>\n' +
                      '• .unfollow <channel_jid>'
            }, { quoted: myquoted });
        }

        const input = args.join(' ').trim();
        let channelJid = '';

        // Check if input is a URL or JID
        if (input.includes('whatsapp.com/channel/')) {
            const channelCodeMatch = input.match(/channel\/([a-zA-Z0-9]+)/);
            if (!channelCodeMatch) {
                return await socket.sendMessage(sender, {
                    text: '*❌ Invalid channel URL format*'
                }, { quoted: myquoted });
            }
            channelJid = `${channelCodeMatch[1]}@newsletter`;
        } else if (input.includes('@newsletter')) {
            channelJid = input;
        } else {
            channelJid = `${input}@newsletter`;
        }

        await socket.sendMessage(sender, { react: { text: '➖', key: msg.key } });

        try {
            await socket.newsletterUnfollow(channelJid);
            
            // Remove from config if owner
            if (isOwner(sender)) {
                const userConfig = (await loadUserConfigFromMongoDB(number)) || config;
                const index = userConfig.NEWSLETTER_JIDS.indexOf(channelJid);
                if (index > -1) {
                    userConfig.NEWSLETTER_JIDS.splice(index, 1);
                    
                    // Update global config as well for consistency
                    config.NEWSLETTER_JIDS = userConfig.NEWSLETTER_JIDS;
                    await updateUserConfig(number, userConfig);
                }
            }

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
            
            await socket.sendMessage(sender, {
                text: `✅ *Successfully unfollowed channel*\n\n*JID:* ${channelJid}`
            }, { quoted: myquoted });

        } catch (error) {
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `*❌ Failed to unfollow channel*\n\nJID: ${channelJid}`
            }, { quoted: myquoted });
        }

    } catch (error) {
        console.error('❌ Unfollow error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ Error:* ${error.message || 'Failed to unfollow channel'}`
        }, { quoted: myquoted });
    }
    break;
}




                case 'updatecj': {
                    try {
                        // Get current user's config
                        const userConfig = (await loadUserConfigFromMongoDB(number)) || { ...config };

                        // Update newsletter JIDs
                        userConfig.NEWSLETTER_JIDS = [...config.NEWSLETTER_JIDS];
                        userConfig.NEWSLETTER_REACT_EMOJIS = [...config.NEWSLETTER_REACT_EMOJIS];
                        userConfig.AUTO_REACT_NEWSLETTERS = config.AUTO_REACT_NEWSLETTERS;

                        // Save updated config
                        await updateUserConfig(number, userConfig);

                        // Apply settings
                        applyConfigSettings(userConfig);

                        // Auto-follow new newsletters for active session
                        if (activeSockets.has(number)) {
                            const userSocket = activeSockets.get(number);
                            for (const newsletterJid of config.NEWSLETTER_JIDS) {
                                try {
                                    await userSocket.newsletterFollow(newsletterJid);
                                    console.log(`✅ ${number} followed newsletter: ${newsletterJid}`);
                                } catch (error) {
                                    console.warn(`⚠️ ${number} failed to follow ${newsletterJid}: ${error.message}`);
                                }
                            }
                        }

                        // Send success message
                        await socket.sendMessage(sender, {
                            image: { url: logo },
                            caption: formatMessage(
                                '📝 NEWSLETTER CONFIG UPDATE',
                                `Successfully updated your newsletter configuration!\n\n` +
                                `Current Newsletter JIDs:\n${config.NEWSLETTER_JIDS.join('\n')}\n\n` +
                                `Auto-React: ${config.AUTO_REACT_NEWSLETTERS === 'true' ? '✅ Enabled' : '❌ Disabled'}\n` +
                                `React Emojis: ${config.NEWSLETTER_REACT_EMOJIS.join(', ')}`,
                                'JANI 𝐌𝐃 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓'
                            )
                        }, { quoted: msg });

                    } catch (error) {
                        console.error('❌ Update CJ command failed:', error);
                        await socket.sendMessage(sender, {
                            text: `*❌ Error updating config:*\n${error.message}`
                        }, { quoted: msg });
                    }
                    break;
                }

// WhatsApp JID Command - Get JID of a User - Last Update 2025-August-17
case 'jid': {
    // Get user number from JID
    const userNumber = sender.split('@')[0]; // Extract number only

    await socket.sendMessage(sender, { 
        react: { 
            text: "🆔", // Reaction emoji
            key: msg.key 
        } 
    });
    
    await socket.sendMessage(sender, {
        text: `  🈸 *JANI MD JID INFO* 🈸\n\n🆔 *Chat JID:* ${sender}\n\n${footer}`.trim(),
        contextInfo: contextInfo 
    }, { quoted: myquoted });

    break;
}
                case 'addnewsletter': {
                    if (!isOwner(sender)) {
                        return await socket.sendMessage(sender, {
                            text: `*❌ This command is only for the owner.*`
                        }, { quoted: msg });
                    }

                    if (!args[0]) {
                        return await socket.sendMessage(sender, {
                            text: '*Please provide a newsletter JID\nExample: .addnewsletter 120363xxxxxxxxxx@newsletter*'
                        }, { quoted: msg });
                    }

                    const newJid = args[0];
                    if (!newJid.endsWith('@newsletter')) {
                        return await socket.sendMessage(sender, {
                            text: '*❌ Invalid JID format. Must end with @newsletter*'
                        }, { quoted: msg });
                    }

                    if (!config.NEWSLETTER_JIDS.includes(newJid)) {
                        const userConfig = (await loadUserConfigFromMongoDB(number)) || { ...config };
                        userConfig.NEWSLETTER_JIDS.push(newJid);
                        userConfig.NEWSLETTER_JIDS = config.NEWSLETTER_JIDS;
                        userConfig.NEWSLETTER_REACT_EMOJIS = config.NEWSLETTER_REACT_EMOJIS;
                        userConfig.AUTO_REACT_NEWSLETTERS = config.AUTO_REACT_NEWSLETTERS;
                        config.NEWSLETTER_JIDS.push(newJid);

                        await updateUserConfig(number, userConfig);
                        applyConfigSettings(userConfig);

                        try {
                            await socket.newsletterFollow(newJid);
                            console.log(`✅ Followed new newsletter: ${newJid}`);

                            await socket.sendMessage(sender, {
                                image: { url: logo },
                                caption: formatMessage(
                                    '✅ NEWSLETTER ADDED & FOLLOWED',
                                    `Successfully added and followed newsletter:\n${newJid}\n\n` +
                                    `Total newsletters: ${config.NEWSLETTER_JIDS.length}\n` +
                                    `Auto-react: ${config.AUTO_REACT_NEWSLETTERS === 'true' ? '✅ Enabled' : '❌ Disabled'}\n` +
                                    `React emojis: ${config.NEWSLETTER_REACT_EMOJIS.join(', ')}`,
                                    'JANI 𝐌𝐃 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓'
                                )
                            }, { quoted: msg });
                        } catch (error) {
                            console.error(`❌ Failed to follow newsletter ${newJid}:`, error.message);

                            await socket.sendMessage(sender, {
                                image: { url: logo },
                                caption: formatMessage(
                                    '⚠️ NEWSLETTER ADDED (Follow Failed)',
                                    `Newsletter added but follow failed:\n${newJid}\n\n` +
                                    `Error: ${error.message}\n` +
                                    `Total newsletters: ${config.NEWSLETTER_JIDS.length}`,
                                    'JANI 𝐌𝐃 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓'
                                )
                            }, { quoted: msg });
                        }
                    } else {
                        await socket.sendMessage(sender, {
                            text: '*⚠️ This newsletter JID is already in the list.*'
                        }, { quoted: msg });
                    }
                    break;
                }

                case 'listnewsletters': {
                    const userConfig = (await loadUserConfigFromMongoDB(number)) || config;
                    const currentNewsletters = userConfig.NEWSLETTER_JIDS || config.NEWSLETTER_JIDS;

                    const newsletterList = currentNewsletters.map((jid, index) =>
                        `${index + 1}. ${jid}`
                    ).join('\n');

                    await socket.sendMessage(sender, {
                        image: { url: logo },
                        caption: formatMessage(
                            '📋 AUTO-REACT NEWSLETTER LIST',
                            `Auto-react enabled for:\n\n${newsletterList || 'No newsletters added'}\n\n` +
                            `React Emojis: ${config.NEWSLETTER_REACT_EMOJIS.join(', ')}\n` +
                            `Status: ${config.AUTO_REACT_NEWSLETTERS === 'true' ? '✅ Active' : '❌ Inactive'}\n` +
                            `Total: ${currentNewsletters.length} newsletters`,
                            'JANI 𝐌𝐃 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓'
                        )
                    }, { quoted: msg });
                    break;
                }

                case 'removenewsletter': {
                    if (!isOwner(sender)) {
                        return await socket.sendMessage(sender, {
                            text: '*❌ This command is only for the owner.*'
                        }, { quoted: msg });
                    }

                    if (!args[0]) {
                        const newsletterList = config.NEWSLETTER_JIDS.map((jid, index) =>
                            `${index + 1}. ${jid}`
                        ).join('\n');

                        return await socket.sendMessage(sender, {
                            text: `*Please provide a newsletter JID to remove*\n\nCurrent newsletters:\n${newsletterList || 'No newsletters added'}`
                        }, { quoted: msg });
                    }

                    const removeJid = args[0];
                    const index = config.NEWSLETTER_JIDS.indexOf(removeJid);

                    const userConfig = (await loadUserConfigFromMongoDB(number)) || { ...config };
                    const userIndex = userConfig.NEWSLETTER_JIDS.indexOf(removeJid);

                    if (index > -1 || userIndex > -1) {
                        config.NEWSLETTER_JIDS.splice(index, 1);
                        userConfig.NEWSLETTER_JIDS = [...config.NEWSLETTER_JIDS];
                        await updateUserConfig(number, userConfig);
                        applyConfigSettings(userConfig);

                        try {
                            await socket.newsletterUnfollow(removeJid);
                            console.log(`✅ Unfollowed newsletter: ${removeJid}`);
                        } catch (error) {
                            console.error(`Failed to unfollow newsletter: ${error.message}`);
                        }

                        await socket.sendMessage(sender, {
                            image: { url: logo },
                            caption: formatMessage(
                                '🗑️ NEWSLETTER REMOVED',
                                `Successfully removed newsletter:\n${removeJid}\n\n` +
                                `Remaining newsletters: ${config.NEWSLETTER_JIDS.length}`,
                                'JANI 𝐌𝐃 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓'
                            )
                        }, { quoted: msg });
                    } else {
                        await socket.sendMessage(sender, {
                            text: '*❌ This newsletter JID is not in the list.*'
                        }, { quoted: msg });
                    }
                    break;
                }

                case 'togglenewsletterreact': {
                    if (!isOwner(sender)) {
                        return await socket.sendMessage(sender, {
                            text: '*❌ This command is only for the owner.*'
                        }, { quoted: msg });
                    }

                    config.AUTO_REACT_NEWSLETTERS = config.AUTO_REACT_NEWSLETTERS === 'true' ? 'false' : 'true';

                    const userConfig = (await loadUserConfigFromMongoDB(number)) || { ...config };
                    userConfig.AUTO_REACT_NEWSLETTERS = config.AUTO_REACT_NEWSLETTERS;
                    userConfig.NEWSLETTER_JIDS = [...config.NEWSLETTER_JIDS];
                    userConfig.NEWSLETTER_REACT_EMOJIS = [...config.NEWSLETTER_REACT_EMOJIS];
                    await updateUserConfig(number, userConfig);
                    applyConfigSettings(userConfig);

                    await socket.sendMessage(sender, {
                        image: { url: logo },
                        caption: formatMessage(
                            '🔄 NEWSLETTER AUTO-REACT TOGGLED',
                            `Newsletter auto-react is now: ${config.AUTO_REACT_NEWSLETTERS === 'true' ? '✅ ENABLED' : '❌ DISABLED'}\n\n` +
                            `Active for ${config.NEWSLETTER_JIDS.length} newsletters`,
                            'JANI 𝐌𝐃 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓'
                        )
                    }, { quoted: msg });
                    break;
                }

                case 'setnewsletteremojis': {
                    if (!isOwner(sender)) {
                        return await socket.sendMessage(sender, {
                            text: '*❌ This command is only for the owner.*'
                        }, { quoted: msg });
                    }

                    if (args.length === 0) {
                        return await socket.sendMessage(sender, {
                            text: `*Please provide emojis*\nCurrent emojis: ${config.NEWSLETTER_REACT_EMOJIS.join(', ')}\n\nExample: .setnewsletteremojis ❤️ 🔥 😍`
                        }, { quoted: msg });
                    }

                    config.NEWSLETTER_REACT_EMOJIS = args;

                    const userConfig = (await loadUserConfigFromMongoDB(number)) || { ...config };
                    userConfig.NEWSLETTER_REACT_EMOJIS = config.NEWSLETTER_REACT_EMOJIS;
                    await updateUserConfig(number, userConfig);
                    applyConfigSettings(userConfig);

                    await socket.sendMessage(sender, {
                        image: { url: logo },
                        caption: formatMessage(
                            '✅ NEWSLETTER EMOJIS UPDATED',
                            `New react emojis: ${config.NEWSLETTER_REACT_EMOJIS.join(', ')}`,
                            'JANI 𝐌𝐃 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓'
                        )
                    }, { quoted: msg });
                    break;
                }


                // YouTube Music Downloader Command - Download Music from YouTube - Last Update 2025-August-14
case 'play':
case 'ytmp3':
case 'song': {
    const useButton = userConfig.BUTTON === 'true';
    if(useButton){
        const yts = require('yt-search');

        function extractYouTubeId(url) {
            const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
            const match = url.match(regex);
            return match ? match[1] : null;
        }

        function convertYouTubeLink(input) {
            const videoId = extractYouTubeId(input);
            if (videoId) {
                return `https://www.youtube.com/watch?v=${videoId}`;
            }
            return input;
        }

        const q = msg.message?.conversation || 
        msg.message?.extendedTextMessage?.text || 
        msg.message?.imageMessage?.caption || 
        msg.message?.videoMessage?.caption || '';

        if (!q || q.trim() === '') {
            return await socket.sendMessage(sender, { text: '*`Need YT_URL or Title`*' });
        }

        const fixedQuery = convertYouTubeLink(q.trim());

        try {
            const search = await yts(fixedQuery);
            const data = search.videos[0];
            if (!data) {
                return await socket.sendMessage(sender, { text: '*`No results found`*' });
            }

            const url = data.url;
            const captionText = `◈ *AUDIO DOWNLOADER*

◈=======================◈
╭──────────────╮
┃🎵 *Title:* \`${data.title}\`
┃⏱️ *Duration:* ${data.timestamp}
┃👀 *Views:* ${data.views}
┃📅 *Release Date:* ${data.ago}
╰──────────────╯
◈=======================◈`;

    await socket.sendMessage(m.chat, {
        react: {
            text: '🎶',
            key: msg.key
        }
    });

        // Send NativeFlow single_select button menu
        await socket.sendMessage(sender, {
            buttons: [
                {
                    buttonId: 'action',
                    buttonText: {
                        displayText: '📂 Select Download Type'
                    },
                    type: 4,
                    nativeFlowInfo: {
                        name: 'single_select',
                        paramsJson: JSON.stringify({
                            title: 'Select Format ❏',
                            sections: [
                                {
                                    title: 'Choose file type to download:',
                                    highlight_label: '',
                                    rows: [
                                        {
                                            title: '🎧 Audio (Normal)',
                                            description: 'Download as audio file',
                                            id: `${prefix}download_audio ${url}`,
                                        },
                                        {
                                            title: '📄 Document (MP3)',
                                            description: 'Download as MP3 document',
                                            id: `${prefix}download_doc ${url}`,
                                        },
                                        {
                                            title: '🎙 Voice Note',
                                            description: 'Download as PTT (voice message)',
                                            id: `${prefix}download_voice ${url}`,
                                        },
                                    ],
                                },
                            ],
                        }),
                    },
                },
            ],
            headerType: 1,
            viewOnce: true,
            image: { url: data.thumbnail },
            caption: captionText,
            contextInfo: contextInfo,
        }, { quoted: myquoted });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: "*`Error occurred while searching`*" });
    }
} else

    {                    
        const yts = require('yt-search');
        const ddownr = require('denethdev-ytmp3');

        function extractYouTubeId(url) {
            const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
            const match = url.match(regex);
            return match ? match[1] : null;
        }

        function convertYouTubeLink(input) {
            const videoId = extractYouTubeId(input);
            if (videoId) {
                return `https://www.youtube.com/watch?v=${videoId}`;
            }
            return input;
        }

        const q = msg.message?.conversation || 
        msg.message?.extendedTextMessage?.text || 
        msg.message?.imageMessage?.caption || 
        msg.message?.videoMessage?.caption || '';

        if (!q || q.trim() === '') {
            return await socket.sendMessage(sender, { text: '*`Need YT_URL or Title`*' });
        }

        const fixedQuery = convertYouTubeLink(q.trim());

        try {
            const search = await yts(fixedQuery);
            const data = search.videos[0];
            if (!data) {
                return await socket.sendMessage(sender, { text: '*`No results found`*' });
            }

            const url = data.url;
            const desc = `◈ *AUDIO DOWNLOADER*

◈=======================◈
╭──────────────╮
┃🎵 *Title:* \`${data.title}\`
┃⏱️ *Duration:* ${data.timestamp}
┃👀 *Views:* ${data.views}
┃📅 *Release Date:* ${data.ago}
╰──────────────╯
◈=======================◈

${footer}
`;

await socket.sendMessage(sender, {
    image: { url: data.thumbnail },
    caption: desc,
    contextInfo: contextInfo,
}, { quoted: myquoted });

await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });


const apiUrl = `${apibase}/download/ytmp3?apikey=${apikey}&url=${encodeURIComponent(videoUrl)}`;
const result = await axios.get(apiUrl, { timeout: 15000 }).then(r => r.data).catch(e => null);
const downloadLink = result.result.downloadUrl;


await socket.sendMessage(sender, { react: { text: '⬆️', key: msg.key } });
await socket.sendMessage(sender, {
    audio: { url: downloadLink },
    mimetype: "audio/mpeg",
    ptt: true
}, { quoted: msg });
} catch (err) {
    console.error(err);
    await socket.sendMessage(sender, { text: "*`Error occurred while downloading`*" });
}
}
    break;
}

case 'download_audio': {
    const url = args[0]; // first argument after the command
    if (!url) return socket.sendMessage(sender, { text: "*No URL provided*" });

    try {
        await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });

        const apiUrl = `${apibase}/download/ytmp3?apikey=${apikey}&url=${encodeURIComponent(url)}`;
        const results = await axios.get(apiUrl).then(r => r.data).catch(e => null);
        const result = results.result;

        await socket.sendMessage(sender, {
            audio: { url: result.download_url },
            mimetype: "audio/mpeg"
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: "*Error downloading audio*" });
    }
    break;
}

case 'download_doc': {
    const url = args[0];
    if (!url) return socket.sendMessage(sender, { text: "*No URL provided*" });

    try {
    await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });
    const apiUrl = `${apibase}/download/ytmp3?apikey=${apikey}&url=${encodeURIComponent(url)}`;
    const results = await axios.get(apiUrl).then(r => r.data).catch(e => null);
    const result = results.result;
        await socket.sendMessage(sender, {
            document: { url: result.download_url },
            mimetype: "audio/mpeg",
            fileName: "song.mp3"
        }, { quoted: msg });
    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: "*Error downloading document*" });
    }
    break;
}

case 'download_voice': {
    const url = args[0];
    if (!url) return socket.sendMessage(sender, { text: "*No URL provided*" });

    try {
        await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });
        const apiUrl = `${apibase}/download/ytmp3?apikey=${apikey}&url=${encodeURIComponent(url)}`;
        const results = await axios.get(apiUrl).then(r => r.data).catch(e => null);
        const result = results.result;
        await socket.sendMessage(sender, {
            audio: { url: result.download_url },
            mimetype: "audio/mpeg",
            ptt: true
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: "*Error downloading voice note*" });
    }
    break;
}


case 'boom': {
    if (args.length < 2) {
        return await socket.sendMessage(sender, {
            text: "📛 *Usage:* `.boom <count> <message>`\n📌 *Example:* `.boom 100 Hello*`"
        }, { quoted: myquoted });
    }

    const count = parseInt(args[0]);

    if (isNaN(count) || count <= 0 || count > 500) {
        return await socket.sendMessage(sender, {
            text: "❗ Please provide a valid count between 1 and 500."
        }, { quoted: myquoted });
    }

    const message = args.slice(1).join(" ");
    for (let i = 0; i < count; i++) {
        await socket.sendMessage(sender, { text: message }, { quoted: myquoted });
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    break;
}

case 'set' :
case 'settings' :
case 'setting': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    const useButton = userConfig.BUTTON === 'true';
    let currentConfig = (await loadUserConfigFromMongoDB(sanitized)) || { ...config };

    if (args.length > 0) {
        if (senderNum !== sanitized && senderNum !== ownerNum) {
            return await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can view settings.' }, { quoted: qMessage });
        }
        const settingsText = `
*╭─「 CURRENT SETTINGS 」─●●➤*  
*│ 👁️  AUTO STATUS SEEN:* ${currentConfig.AUTO_VIEW_STATUS}
*│ ❤️  AUTO STATUS REACT:* ${currentConfig.AUTO_LIKE_STATUS}
*│ 🎥  AUTO RECORDING:* ${currentConfig.AUTO_RECORDING}
*│ 🔘  SHOW BUTTONS:* ${currentConfig.BUTTONS === 'false' ? 'false' : 'true'}
*│ 👍  AUTO MSG REACT:* ${currentConfig.AUTO_REACT_MESSAGES}
*│ 🔣  PREFIX:* ${currentConfig.PREFIX}
*│ 🎭  STATUS EMOJIS:* ${currentConfig.AUTO_LIKE_EMOJI.join(', ')}
*╰──────────────●●➤*

*Use ${ prefix || '.'}Setting To Change Settings Viva Menu*
    `;
        return await socket.sendMessage(sender, {
            image: { url: logo },
            caption: settingsText
        }, { quoted: myquoted });
    }

    await socket.sendMessage(sender, { react: { text: '⚙️', key: msg.key } });
    
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      return await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change settings.' }, { quoted: myquoted });
    }

    const settingsCaption = `*╭────────────╮*\n*UPADATE SETTING*\n*╰────────────╯*\n\n` +
        `┏━━━━━━━━━━◆◉◉➤\n` +
        `┃◉ *Auto Status Seen:* ${currentConfig.AUTO_VIEW_STATUS}\n` +
        `┃◉ *Auto Status React:* ${currentConfig.AUTO_LIKE_STATUS}\n` +
        `┃◉ *Auto Recording:* ${currentConfig.AUTO_RECORDING}\n` +
        `┃◉ *Auto Msg React:* ${currentConfig.AUTO_REACT_MESSAGES}\n` +
        `┃◉ *Show Buttons:* ${currentConfig.BUTTONS === 'false' ? 'false' : 'true'}\n` +
        `┃◉ *Prefix:* ${currentConfig.PREFIX}\n` +
        `┗━━━━━━━━━━◆◉◉➤`;

    if (useButton) {
        const settingOptions = {
            name: 'single_select',
            paramsJson: JSON.stringify({
                title: `SETTINGS`,
                sections: [
                    {
                        title: '➤ AUTO RECORDING',
                        rows: [
                            { title: 'AUTO RECORDING ON', description: '', id: `${prefix}autorecording on` },
                            { title: 'AUTO RECORDING OFF', description: '', id: `${prefix}autorecording off` },
                        ],
                    },
                    {
                        title: '➤ AUTO STATUS SEEN',
                        rows: [
                            { title: 'AUTO STATUS SEEN ON', description: '', id: `${prefix}autoview on` },
                            { title: 'AUTO STATUS SEEN OFF', description: '', id: `${prefix}autoview off` },
                        ],
                    },
                    {
                        title: '➤ AUTO STATUS REACT',
                        rows: [
                            { title: 'AUTO STATUS REACT ON', description: '', id: `${prefix}autolike on` },
                            { title: 'AUTO STATUS REACT OFF', description: '', id: `${prefix}autolike off` },
                        ],
                    },
                    {
                        title: '➤ AUTO MESSAGE REACT',
                        rows: [
                            { title: 'AUTO MESSAGE REACT ON', description: '', id: `${prefix}autoreact on` },
                            { title: 'AUTO MESSAGE REACT OFF', description: '', id: `${prefix}autoreact off` },
                        ],
                    },
                    {
                        title: '➤ SHOW BUTTONS MESSAGE',
                        rows: [
                            { title: 'BUTTONS ON', description: '', id: `${prefix}buttons on` },
                            { title: 'BUTTONS OFF', description: '', id: `${prefix}buttons off` },
                        ],
                    },
                    {
                        title: '➤ STATUS EMOJIS',
                        rows: [
                            { title: 'SET STATUS EMOJIS', description: '', id: `${prefix}setemojis` },
                        ]
                    },
                ],
            }),
        };

        await socket.sendMessage(sender, {
            headerType: 1,
            viewOnce: true,
            image: { url: logo },
            caption: settingsCaption,
            buttons: [
                {
                    buttonId: 'settings_action',
                    buttonText: { displayText: '⚙️ CONFIGURE SETTINGS' },
                    type: 4,
                    nativeFlowInfo: settingOptions,
                },
            ],
        }, { quoted: msg });
    } else {
        // Non-button mode: Text-based menu
        const textMenu = `
${settingsCaption}

*Reply with a number to toggle a setting:*

1 │❯❯◦ Auto Recording
2 │❯❯◦ Auto View Status
3 │❯❯◦ Auto Status React
4 │❯❯◦ Show Buttons
5 │❯❯◦ Auto Message React
6 │❯❯◦ Status Emojis
`;

        const sentMsg = await socket.sendMessage(sender, {
            image: { url: logo },
            caption: textMenu
        }, { quoted: msg });

        const handler = async ({ messages }) => {
            const replyMsg = messages[0];
            if (!replyMsg.message?.extendedTextMessage || replyMsg.key.fromMe) return;

            const context = replyMsg.message.extendedTextMessage.contextInfo;
            if (context?.stanzaId !== sentMsg.key.id) return;

            const selection = parseInt(replyMsg.message.extendedTextMessage.text.trim());
            let responseText = '';

            // Re-fetch config to ensure it's the latest
            let userConf = (await loadUserConfigFromMongoDB(sanitized)) || { ...config };

            switch (selection) {
                case 1:
                    userConf.AUTO_RECORDING = userConf.AUTO_RECORDING === 'true' ? 'false' : 'true';
                    responseText = `✅ *Auto Recording:* ${userConf.AUTO_RECORDING === 'true' ? '✅ ON' : '❌ OFF'}`;
                    break;
                case 2:
                    userConf.AUTO_VIEW_STATUS = userConf.AUTO_VIEW_STATUS === 'true' ? 'false' : 'true';
                    responseText = `✅ *Auto View Status:* ${userConf.AUTO_VIEW_STATUS === 'true' ? '✅ ON' : '❌ OFF'}`;
                    break;
                case 3:
                    userConf.AUTO_LIKE_STATUS = userConf.AUTO_LIKE_STATUS === 'true' ? 'false' : 'true';
                    responseText = `✅ *Auto Like Status:* ${userConf.AUTO_LIKE_STATUS === 'true' ? '✅ ON' : '❌ OFF'}`;
                    break;
                case 4:
                    userConf.BUTTON = userConf.BUTTON === 'true' ? 'false' : 'true';
                    responseText = `✅ *Button Mode:* ${userConf.BUTTON === 'true' ? '✅ ON' : '❌ OFF'}`;
                    break;
                case 5:
                    userConf.AUTO_REACT_MESSAGES = userConf.AUTO_REACT_MESSAGES === 'true' ? 'false' : 'true';
                    responseText = `✅ *Auto Message React:* ${userConf.AUTO_REACT_MESSAGES === 'true' ? '✅ ON' : '❌ OFF'}`;
                    break;
                case 6:
                    return socket.sendMessage(sender, { text: `Please use the command: \`${prefix}setemojis\`` }, { quoted: replyMsg });
                    break;
                default:
                    await socket.sendMessage(sender, { text: '❌ Invalid selection. Please reply with a valid number.' }, { quoted: replyMsg });
                    return;
            }

            // Save the updated config and update the cache
            await updateUserConfig(sanitized, userConf);
            socket.userConfig = userConf;

            await socket.sendMessage(sender, { text: responseText }, { quoted: replyMsg });
            socket.ev.off('messages.upsert', handler); // Clean up listener
        };

        socket.ev.on('messages.upsert', handler);
    }
  } catch (e) {
    console.error('Setting command error:', e);
    await socket.sendMessage(sender, { text: "*❌ Error loading settings!*" }, { quoted: myquoted });
  }
  break;
}


case 'buttons': {
    try {
        // Load user config or use the cached one, creating a default if non-existent
        const currentUserConfig = (await loadUserConfigFromMongoDB(number)) || { ...config, number };

        // Toggle BUTTON value
        currentUserConfig.BUTTON = currentUserConfig.BUTTON === 'true' ? 'false' : 'true';

        // Save back to MongoDB
        await updateUserConfig(number, currentUserConfig);
        // Update the cached config on the socket for immediate effect
        socket.userConfig.BUTTON = currentUserConfig.BUTTON;

        // Respond
        await socket.sendMessage(sender, {
            image: { url: logo },
            caption: formatMessage(
                '🔄 BUTTON MODE TOGGLED',
                `Alive button mode is now: ${userConfig.BUTTON === 'true' ? '✅ ENABLED (Buttons)' : '❌ DISABLED (Normal Message)'}`,
                footer
            )
        }, { quoted: myquoted });

    } catch (error) {
        console.error("❌ ToggleButton command error:", error);
        await socket.sendMessage(sender, { text: "❌ Failed to toggle button setting" });
    }
    break;
}


case 'setprefix': {
    
    const currentPrefix = userConfig.PREFIX || config.PREFIX;
    if (!args[0]) {
        return await socket.sendMessage(sender, {
            text: `*Current prefix:* ${currentPrefix}\n*Usage:* ${currentPrefix}setprefix [new prefix]`
        }, { quoted: msg });
    }

    const newPrefix = args[0];
    const oldPrefix = userConfig.PREFIX || config.PREFIX;

    const currentUserConfig = (await loadUserConfigFromMongoDB(number)) || { ...config };
    currentUserConfig.PREFIX = newPrefix;
    await updateUserConfig(number, currentUserConfig);
    socket.userConfig.PREFIX = newPrefix;

    await socket.sendMessage(sender, {
        text: `✅ *Prefix changed*\n*Old:* ${oldPrefix}\n*New:* ${newPrefix}`
    }, { quoted: msg });
    break;
}

case 'autoview': {
    

    const currentStatus = userConfig.AUTO_VIEW_STATUS || config.AUTO_VIEW_STATUS;
    if (!args[0] || !['on', 'off'].includes(args[0].toLowerCase())) {
        return await socket.sendMessage(sender, {
            text: `*Current:* ${currentStatus}\n*Usage:* ${userConfig.PREFIX || config.PREFIX}autoview [on/off]`
        }, { quoted: msg });
    }

    const newStatus = args[0].toLowerCase() === 'on' ? 'true' : 'false';

    const currentUserConfig = (await loadUserConfigFromMongoDB(number)) || { ...config };
    currentUserConfig.AUTO_VIEW_STATUS = newStatus;
    await updateUserConfig(number, currentUserConfig);
    socket.userConfig.AUTO_VIEW_STATUS = newStatus;

    await socket.sendMessage(sender, {
        text: `✅ *Auto View Status:* ${newStatus === 'true' ? '✅ ON' : '❌ OFF'}`
    }, { quoted: msg });
    break;
}

case 'autolike': {
    

    const currentStatus = userConfig.AUTO_LIKE_STATUS || config.AUTO_LIKE_STATUS;
    if (!args[0] || !['on', 'off'].includes(args[0].toLowerCase())) {
        return await socket.sendMessage(sender, {
            text: `*Current:* ${currentStatus}\n*Usage:* ${userConfig.PREFIX || config.PREFIX}autolike [on/off]`
        }, { quoted: msg });
    }

    const newStatus = args[0].toLowerCase() === 'on' ? 'true' : 'false';

    const currentUserConfig = (await loadUserConfigFromMongoDB(number)) || { ...config };
    currentUserConfig.AUTO_LIKE_STATUS = newStatus;
    await updateUserConfig(number, currentUserConfig);
    socket.userConfig.AUTO_LIKE_STATUS = newStatus;

    await socket.sendMessage(sender, {
        text: `✅ *Auto Like Status:* ${newStatus === 'true' ? '✅ ON' : '❌ OFF'}`
    }, { quoted: msg });
    break;
}

case 'autorecording': {
    

    const currentStatus = userConfig.AUTO_RECORDING || config.AUTO_RECORDING;
    if (!args[0] || !['on', 'off'].includes(args[0].toLowerCase())) {
        return await socket.sendMessage(sender, {
            text: `*Current:* ${currentStatus}\n*Usage:* ${userConfig.PREFIX || config.PREFIX}autorecording [on/off]`
        }, { quoted: msg });
    }

    const newStatus = args[0].toLowerCase() === 'on' ? 'true' : 'false';

    const currentUserConfig = (await loadUserConfigFromMongoDB(number)) || { ...config };
    currentUserConfig.AUTO_RECORDING = newStatus;
    await updateUserConfig(number, currentUserConfig);
    socket.userConfig.AUTO_RECORDING = newStatus;

    await socket.sendMessage(sender, {
        text: `✅ *Auto Recording:* ${newStatus === 'true' ? '✅ ON' : '❌ OFF'}`
    }, { quoted: msg });
    break;
}

case 'autoreact': {
    const subCommand = args[0]?.toLowerCase();
    const currentUserConfig = (await loadUserConfigFromMongoDB(number)) || { ...config };

    if (!subCommand) {
        const currentStatus = currentUserConfig.AUTO_REACT_MESSAGES || config.AUTO_REACT_MESSAGES;
        const currentEmojis = (currentUserConfig.AUTO_REACT_MESSAGES_EMOJIS || config.AUTO_REACT_MESSAGES_EMOJIS).join(' ');
        return await socket.sendMessage(sender, {
            text: `*⚙️ Manage Auto Message React*\n\n` +
                  `*Status:* ${currentStatus === 'true' ? '✅ ON' : '❌ OFF'}\n` +
                  `*Emojis:* ${currentEmojis}\n\n` +
                  `*Usage:*\n` +
                  `• To toggle: \`${prefix}autoreact on/off\`\n` +
                  `• To manage emojis: \`${prefix}autoreact emojis <action>\`\n\n` +
                  `*Emoji Actions:*\n` +
                  `• \`set ❤️ 😂\`: Replace all emojis\n` +
                  `• \`add 👍\`: Add an emoji\n` +
                  `• \`remove 😂\`: Remove an emoji`
        }, { quoted: msg });
    }

    if (subCommand === 'on' || subCommand === 'off') {
        const newStatus = subCommand === 'on' ? 'true' : 'false';
        currentUserConfig.AUTO_REACT_MESSAGES = newStatus;
        await updateUserConfig(number, currentUserConfig);
        socket.userConfig.AUTO_REACT_MESSAGES = newStatus;
        await socket.sendMessage(sender, { text: `✅ *Auto Message React:* ${newStatus === 'true' ? '✅ ON' : '❌ OFF'}` }, { quoted: msg });

    } else if (subCommand === 'emojis') {
        const emojiAction = args[1]?.toLowerCase();
        const emojis = args.slice(2);
        const currentEmojis = currentUserConfig.AUTO_REACT_MESSAGES_EMOJIS || config.AUTO_REACT_MESSAGES_EMOJIS;
        let newEmojisList;
        let responseMessage = '';

        switch (emojiAction) {
            case 'add':
                if (emojis.length === 0) return await socket.sendMessage(sender, { text: `*Please provide emojis to add.*\nExample: \`${prefix}autoreact emojis add 👍 💖\`` }, { quoted: msg });
                newEmojisList = [...new Set([...currentEmojis, ...emojis])];
                responseMessage = `✅ *Message React Emojis Added!*`;
                break;
            case 'remove':
                if (emojis.length === 0) return await socket.sendMessage(sender, { text: `*Please provide emojis to remove.*\nExample: \`${prefix}autoreact emojis remove 👍\`` }, { quoted: msg });
                newEmojisList = currentEmojis.filter(e => !emojis.includes(e));
                responseMessage = `✅ *Message React Emojis Removed!*`;
                break;
            case 'set':
                if (emojis.length === 0) return await socket.sendMessage(sender, { text: `*Please provide a new set of emojis.*\nExample: \`${prefix}autoreact emojis set ❤️‍🔥 💯\`` }, { quoted: msg });
                newEmojisList = emojis;
                responseMessage = `✅ *Message React Emoji List Updated!*`;
                break;
            default:
                return await socket.sendMessage(sender, { text: `*❌ Invalid emoji action.*\nUse 'add', 'remove', or 'set'.` }, { quoted: msg });
        }

        currentUserConfig.AUTO_REACT_MESSAGES_EMOJIS = newEmojisList;
        await updateUserConfig(number, currentUserConfig);
        socket.userConfig.AUTO_REACT_MESSAGES_EMOJIS = newEmojisList;

        await socket.sendMessage(sender, { text: `${responseMessage}\n*New Emojis:* ${newEmojisList.join(' ')}` }, { quoted: msg });
    } else {
        await socket.sendMessage(sender, { text: `*❌ Invalid command.*\nUse \`${prefix}autoreact on/off\` or \`${prefix}autoreact emojis <action>\`.` }, { quoted: msg });
    }
    break;
}

case 'setemojis': {
    const currentUserConfig = (await loadUserConfigFromMongoDB(number)) || { ...config };
    const currentEmojis = currentUserConfig.AUTO_LIKE_EMOJI || config.AUTO_LIKE_EMOJI;

    const subCommand = args[0]?.toLowerCase();
    const emojis = args.slice(1);

    if (!subCommand) {
        // No arguments, show current status and help
        return await socket.sendMessage(sender, {
            text: `*⚙️ Manage Auto-Like Emojis*\n\n` +
                  `*Current Emojis:* ${currentEmojis.join(' ')}\n\n` +
                  `*How to use:*\n` +
                  `• To *replace* all: \`${prefix}setemojis set ❤️ 🔥 ✨\`\n` +
                  `• To *add* an emoji: \`${prefix}setemojis add 😊\`\n` +
                  `• To *remove* an emoji: \`${prefix}setemojis remove 🔥\``
        }, { quoted: msg });
    }

    let newEmojisList;
    let responseMessage = '';

    switch (subCommand) {
        case 'add':
            if (emojis.length === 0) {
                return await socket.sendMessage(sender, { text: `*Please provide emojis to add.*\nExample: \`${prefix}setemojis add 👍 💖\`` }, { quoted: msg });
            }
            newEmojisList = [...new Set([...currentEmojis, ...emojis])]; // Add new emojis, ensuring no duplicates
            responseMessage = `✅ *Emojis Added!*`;
            break;

        case 'remove':
            if (emojis.length === 0) {
                return await socket.sendMessage(sender, { text: `*Please provide emojis to remove.*\nExample: \`${prefix}setemojis remove 👍\`` }, { quoted: msg });
            }
            newEmojisList = currentEmojis.filter(e => !emojis.includes(e)); // Remove specified emojis
            responseMessage = `✅ *Emojis Removed!*`;
            break;

        case 'set':
            if (emojis.length === 0) {
                return await socket.sendMessage(sender, { text: `*Please provide a new set of emojis.*\nExample: \`${prefix}setemojis set ❤️‍🔥 💯\`` }, { quoted: msg });
            }
            newEmojisList = emojis; // Overwrite with the new set
            responseMessage = `✅ *Emoji List Updated!*`;
            break;

        default:
            return await socket.sendMessage(sender, { text: `*❌ Invalid sub-command.*\nUse 'add', 'remove', or 'set'.` }, { quoted: msg });
    }

    currentUserConfig.AUTO_LIKE_EMOJI = newEmojisList;
    await updateUserConfig(number, currentUserConfig);
    socket.userConfig.AUTO_LIKE_EMOJI = newEmojisList;

    await socket.sendMessage(sender, {
        text: `${responseMessage}\n*New Emojis:* ${newEmojisList.join(' ')}`
    }, { quoted: msg });
    break;
}



case 'save': {
    try {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quotedMsg) {
            return await socket.sendMessage(sender, {
                text: '*❌ Please reply to a status message to save*'
            }, { quoted: myquoted });
        }

        await socket.sendMessage(sender, { react: { text: '💾', key: msg.key } });

        const userJid = jidNormalizedUser(socket.user.id);

        // Check message type and save accordingly
        if (quotedMsg.imageMessage) {
            const buffer = await downloadAndSaveMedia(quotedMsg.imageMessage, 'image');
            await socket.sendMessage(userJid, {
                image: buffer,
                caption: quotedMsg.imageMessage.caption || '✅ *Status Saved*'
            });
        } else if (quotedMsg.videoMessage) {
            const buffer = await downloadAndSaveMedia(quotedMsg.videoMessage, 'video');
            await socket.sendMessage(userJid, {
                video: buffer,
                caption: quotedMsg.videoMessage.caption || '✅ *Status Saved*'
            });
        } else if (quotedMsg.conversation || quotedMsg.extendedTextMessage) {
            const text = quotedMsg.conversation || quotedMsg.extendedTextMessage.text;
            await socket.sendMessage(userJid, {
                text: `✅ *Status Saved*\n\n${text}`
            });
        } else {
            await socket.sendMessage(userJid, quotedMsg);
        }

        await socket.sendMessage(sender, {
            text: '✅ *Status saved successfully!*'
        }, { quoted: myquoted });

    } catch (error) {
        console.error('❌ Save error:', error);
        await socket.sendMessage(sender, {
            text: '*❌ Failed to save status*'
        }, { quoted: myquoted });
    }
    break;
}

// TikTok Downloader Command - Download TikTok Videos - Last Update 2025-August-14
case 'tt':
case 'ttdl':         
case 'tiktok': {
    const axios = require('axios');

    await socket.sendMessage(sender, { react: { text: '💦', key: msg.key } });

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const link = q.replace(/^([./!]?(tiktok(dl)?|tt(dl)?))\s*/i, '').trim();

    if (!link) {
        return await socket.sendMessage(sender, {
            text: '📌 *Usage:* .tiktok <link>'
        }, { quoted: msg });
    }

    if (!link.includes('tiktok.com')) {
        return await socket.sendMessage(sender, {
            text: '❌ *Invalid TikTok link.*'
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            text: '⏳ Downloading video, please wait...'
        }, { quoted: msg });

        const apiUrl = `https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(link)}`;
        const { data } = await axios.get(apiUrl);

        if (!data?.status || !data?.data) {
            return await socket.sendMessage(sender, {
                text: '❌ Failed to fetch TikTok video.'
            }, { quoted: msg });
        }

        const { title, like, comment, share, author, meta } = data.data;
        const video = meta.media.find(v => v.type === "video");

        if (!video || !video.org) {
            return await socket.sendMessage(sender, {
                text: '❌ No downloadable video found.'
            }, { quoted: msg });
        }

        const caption = `◈ *TIK TOK DOWNLOADER*\n\n◈=======================◈\n╭──────────────╮\n` +
                        `┃👤 *User:* ${author.nickname} (@${author.username})\n` +
                        `┃📖 *Title:* ${title}\n` +
                        `┃👍 *Likes:* ${like}\n`+
                        `┃💬 *Comments:* ${comment}\n`+
                        `┃🔁 *Shares:* ${share}\n`+
                        `╰──────────────╯`+
                        `\n\n${footer}`;

        await socket.sendMessage(sender, {
            video: { url: video.org },
            caption: caption,
            contextInfo: { mentionedJid: [msg.key.participant || sender] }
        }, { quoted: msg });

    } catch (err) {
        console.error("TikTok command error:", err);
        await socket.sendMessage(sender, {
            text: `❌ An error occurred:\n${err.message}`
        }, { quoted: msg });
    }

    break;
}


case 'ai':
case 'gpt':
case 'chat': {
    try {
        if (!args[0]) {
            return await socket.sendMessage(sender, {
                text: '*❌ Please provide a message*\n*Usage:* .ai Hello, how are you?'
            }, { quoted: myquoted });
        }

        const query = args.join(' ');
        
        await socket.sendMessage(sender, { react: { text: '🤖', key: msg.key } });

        const response = await axios.get(`https://apis.davidcyriltech.my.id/ai/chatbot?query=${encodeURIComponent(query)}`);
        
        if (response.data.status !== 200 || !response.data.success) {
            throw new Error('AI service unavailable');
        }

        await socket.sendMessage(sender, {
            text: `*🤖 AI Response:*\n\n${response.data.result}\n\n${footer}`,
            contextInfo
        }, { quoted: myquoted });

    } catch (error) {
        console.error('❌ AI error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ AI Error*\n\nFailed to get response. Please try again.`
        }, { quoted: myquoted });
    }
    break;
}

case 'facebook':
case 'facebok':
case 'fbdl':
case 'fb': {
    const { igdl } = require('ruhend-scraper');
    const useButton = userConfig.BUTTON === 'true';

    if (!args[0]) {
        return socket.sendMessage(sender, {
            text: '❗ *Please provide a valid Facebook video link.*\n\n📌 Example: `.fb https://fb.watch/xyz/`'
        }, { quoted: msg });
    }

    await socket.sendMessage(sender, { react: { text: '🕒', key: msg.key } });

    let res;
    try {
        res = await igdl(args[0]);
    } catch (error) {
        return socket.sendMessage(sender, { text: '❌ *Error obtaining data.*' }, { quoted: msg });
    }

    let result = res.data;
    if (!result || result.length === 0) {
        return socket.sendMessage(sender, { text: '❌ *No result found.*' }, { quoted: msg });
    }

    let hd = result.find(i => i.resolution.includes("720p"));
    let sd = result.find(i => i.resolution.includes("720p (HD)"));
    let firstVideo = result[0];

    if (useButton) {
        // Button-based system
        await socket.sendMessage(sender, {
            buttons: [
                {
                    buttonId: 'action',
                    buttonText: { displayText: '📂 Select Download Quality' },
                    type: 4,
                    nativeFlowInfo: {
                        name: 'single_select',
                        paramsJson: JSON.stringify({
                            title: 'Select FB Video Quality',
                            sections: [
                                {
                                    title: 'Available Downloads:',
                                    rows: [
                                        ...(hd ? [{ title: '🎥 HD (1080p)', description: 'Download in HD quality', id: `${prefix}fb_dl ${hd.url} HD` }] : []),
                                        ...(sd ? [{ title: '📽 SD (720p)', description: 'Download in SD quality', id: `${prefix}fb_dl ${sd.url} SD` }] : [])
                                    ]
                                }
                            ]
                        }),
                    },
                },
            ],
            headerType: 1,
            viewOnce: true,
            image: { url: firstVideo.thumbnail },
            caption: `🎬 *FB VIDEO DOWNLOADER*\n───────────────────\nChoose your preferred quality:`,
            contextInfo: contextInfo
        }, { quoted: msg });

    } else {
        // Old reply-number system
        let menu = `
🎬 *FB VIDEO DOWNLOADER*
────────────────────
🔢 Reply with the number to download:

${hd ? '1 │ Download FB Video in HD' : ''}
${sd ? '2 │ Download FB Video in SD' : ''}

${footer}
`;

        const menuMsg = await socket.sendMessage(sender, {
            image: { url: firstVideo.thumbnail },
            caption: menu
        }, { quoted: msg });

        const fbHandler = async (mUpdate) => {
            const rMsg = mUpdate.messages[0];
            if (!rMsg.message?.extendedTextMessage) return;
            if (rMsg.message.extendedTextMessage.contextInfo?.stanzaId !== menuMsg.key.id) return;
            socket.ev.off('messages.upsert', fbHandler); // Unregister listener
            const selected = rMsg.message.extendedTextMessage.text.trim();

            if (selected === '1' && hd) {
                await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });
                await socket.sendMessage(sender, {
                    video: { url: hd.url },
                    caption: `${footer}`,
                    fileName: 'fb_hd.mp4',
                    mimetype: 'video/mp4'
                }, { quoted: msg });
                await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

            } else if (selected === '2' && sd) {
                await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });
                await socket.sendMessage(sender, {
                    video: { url: sd.url },
                    caption: `${footer}`,
                    fileName: 'fb_sd.mp4',
                    mimetype: 'video/mp4'
                }, { quoted: msg });
                await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

            } else {
                await socket.sendMessage(sender, { text: '❌ Invalid option. Please select 1 or 2.' }, { quoted: msg });
            }
        };
        socket.ev.on('messages.upsert', fbHandler);
    }
    break;
}

// Handler for button click
case 'fb_dl': {
    let url = args[0];
    let quality = args[1] || '';
    if (!url) return socket.sendMessage(sender, { text: "*No download link provided*" });

    try {
        await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });
        await socket.sendMessage(sender, {
            video: { url },
            caption: `${footer}`,
            fileName: `fb_${quality.toLowerCase()}.mp4`,
            mimetype: 'video/mp4'
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (err) {
        await socket.sendMessage(sender, { text: "*Error downloading video*" });
    }
    break;
}
case 'ytmp4':
case 'ytvideo':
case 'video': {
    const yts = require('yt-search');
    const useButton = userConfig.BUTTON === 'true';

    await socket.sendMessage(from, { react: { text: '🎥', key: msg} });

    function extractYouTubeId(url) {
        const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }

    function convertYouTubeLink(input) {
        const videoId = extractYouTubeId(input);
        return videoId ? `https://www.youtube.com/watch?v=${videoId}` : input;
    }

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    if (!q || q.trim() === '') {
        return await socket.sendMessage(from, { text: '*Need YouTube URL or Title*' });
    }

    const fixedQuery = convertYouTubeLink(q.trim());

    try {
        const search = await yts(fixedQuery);
        const data = search.videos[0];
        if (!data) return await socket.sendMessage(from, { text: '*No results found*' });

        const url = data.url;
        const desc = `◈ *VIDEO DOWNLOADER*\n\n`+
        `◈=======================◈\n`+
        `╭──────────────╮\n`+
        `┃🎵 \`Title\`: ${data.title}\n`+
        `┃⏱ \`Duration\`: ${data.timestamp}\n`+
        `┃📊 \`Views\`: ${data.views}\n`+
        `┃📅 \`Release\`: ${data.ago}\n`+
        `╰──────────────╯\n\n`
        // Send thumbnail + button for HD download
        const buttons = [
            { buttonId: `${prefix}downloadvid ${url}`, buttonText: { displayText: 'Download Video' }, type: 1 },
            { buttonId: `${prefix}downloaddoc ${url}`, buttonText: { displayText: 'Download Document' }, type: 1 },
        ];
        if(useButton){
        await socket.sendMessage(from, {
            image: { url: data.thumbnail },
            caption: `${desc}${footer}`,
            footer: 'Click HD to download',
            buttons: buttons,
            headerType: 4
        }, { quoted: msg });

    } else
        {
            const selection = `🔢 Reply below number\n\n`+
                              `1 │❯❯◦ Video File 🎶\n`+
                              `2 │❯❯◦ Document File 📂\n\n`+
                              `${footer}`
            const VidMsg = await socket.sendMessage(from,{
                image: { url: data.thumbnail },
                caption: `${desc}${selection}`,
                contextInfo: contextInfo
            }, { quoted: myquoted })

            const res = await fetch(`${apibase}/download/ytmp4?apikey=${apikey}&url=${url}`);
            const deta = await res.json();

            if (!deta.success || !deta.result?.download_url) {
                return await socket.sendMessage(from, { text: "❌ Download Failed. Try again later." });
            }
            
            let downloadUrl = deta.result.download_url;

            const videoHandler = async (mUpdate) => {
            const rMsg = mUpdate.messages[0];
            if (!rMsg.message?.extendedTextMessage) return;
            if (rMsg.message.extendedTextMessage.contextInfo?.stanzaId !== VidMsg.key.id) return;

            const selected = rMsg.message.extendedTextMessage.text.trim();

            if (selected === '1') {
                await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });
                 await socket.sendMessage(from, {
                    video: { url: downloadUrl },
                    mimetype: "video/mp4",
                    caption: `${footer}`
                }, { quoted: msg });
                await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

            } else if (selected === '2') {
                await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });
                await socket.sendMessage(from,{
                    document:{url:downloadUrl },
                    mimetype:"video/mp4",
                    fileName:data.title + ".mp4",
                    caption :`${footer}`
                }, {quoted:msg})                
                await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
            } else {
                await socket.sendMessage(sender, { text: '❌ Invalid option. Please select 1 or 2.' }, { quoted: msg });
            }
            socket.ev.off('messages.upsert', videoHandler); // Unregister listener
        };
        socket.ev.on('messages.upsert', videoHandler);
        }

    } catch (err) {
        console.error(err);
        await socket.sendMessage(from, { text: "*❌ Error occurred while fetching video info*" });
    }
    break;
}

// Handle button click
case 'downloadvid': {
    const url = args[0]; // buttonId passed like downloadhd_<url>
    if (!url) return await socket.sendMessage(from, { text: "❌ Invalid video URL" });

    try {
        // React immediately
        await socket.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

        // Fetch video download link
        const res = await fetch(`${apibase}/download/ytmp4?apikey=${apikey}&url=${url}`);
        const data = await res.json();
        if (!data.success || !data.result.download_url) {
            return await socket.sendMessage(from, { text: "❌ Download Failed. Try again." });
        }

        const downloadUrl = data.result.download_url;

        // Send video as fast as possible
        await socket.sendMessage(from, {
            video: { url: downloadUrl },
            mimetype: "video/mp4",
            caption: `${footer}`,
        }, { quoted: msg });

        // React after sending
        await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(from, { text: "*❌ Error occurred while downloading video.*" });
    }
    break;
}

case 'downloaddoc': {
    const url = args[0]; // buttonId passed like downloadhd_<url>
    if (!url) return await socket.sendMessage(from, { text: "❌ Invalid video URL" });

    try {
        // React immediately
        await socket.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

        // Fetch video download link
        const res = await fetch(`${apibase}/download/ytmp4?apikey=${apikey}&url=${url}`);
        const data = await res.json();
        if (!data.success || !data.result.download_url) {
            return await socket.sendMessage(from, { text: "❌ Download Failed. Try again." });
        }

        const downloadUrl = data.result.download_url;

        // Send video as fast as possible
        await socket.sendMessage(from, {
            document:{url:downloadUrl },
            mimetype:"video/mp4",        
            fileName:data.result.title + ".mp4",   
            caption :`${footer}`
            }, {quoted:msg})   
        // React after sending
        await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(from, { text: "*❌ Error occurred while downloading video.*" });
    }
    break;
}

case 'movie': {
    try {
        if (!args[0]) {
            return await socket.sendMessage(sender, {
                text: '*❌ Please provide a movie name*\n*Usage:* .movie Deadpool'
            }, { quoted: myquoted });
        }

        const movieQuery = args.join(' ');
        
        await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

        const response = await axios.get(`https://apis.davidcyriltech.my.id/movies/search?query=${encodeURIComponent(movieQuery)}`);
        
        if (!response.data || !response.data.results || response.data.results.length === 0) {
            return await socket.sendMessage(sender, {
                text: `*❌ No movies found for:* ${movieQuery}`
            }, { quoted: myquoted });
        }

        const movies = response.data.results.slice(0, 5);
        
        let movieText = `*🎬 MOVIE SEARCH RESULTS*\n`;
        movieText += `*Query:* ${movieQuery}\n`;
        movieText += `*Found:* ${response.data.results.length} movies\n`;
        movieText += `━━━━━━━━━━━━━━━━━━━━\n\n`;

        movies.forEach((movie, index) => {
            movieText += `*${index + 1}. ${movie.title}*\n`;
            if (movie.year) movieText += `📅 Year: ${movie.year}\n`;
            if (movie.genre) movieText += `🎭 Genre: ${movie.genre}\n`;
            if (movie.rating) movieText += `⭐ Rating: ${movie.rating}\n`;
            if (movie.link) movieText += `🔗 Link: ${movie.link}\n`;
            movieText += `━━━━━━━━━━━━━━━━━━━━\n\n`;
        });

        movieText += `${footer}`;

        await socket.sendMessage(sender, {
            image: { url: movies[0].thumbnail || logo },
            caption: movieText
        }, { quoted: myquoted });

    } catch (error) {
        console.error('❌ Movie search error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ Failed to search movies*\n\nError: ${error.message || 'Unknown error'}`
        }, { quoted: myquoted });
    }
    break;
}

case 'pair':
case 'bot':
case 'freebot': {
    try {
        const botNumber = socket.user.id.split(":")[0].replace(/[^0-9]/g, "");
        const reply = (text) =>
            socket.sendMessage(m.key.remoteJid, { text, mentions: [m.sender] }, { quoted: msg });

        // ✅ Allow only in private chats
        if (m.key.remoteJid.endsWith("@g.us")) {
            return reply(
                `⚠️ *This action is only allowed in private chats.*\n\n` +
                `> Tap here: https://wa.me/+${botNumber}?text=${prefix}freebot`
            );
        }

        const senderId = m.key.remoteJid;
        if (!senderId) return reply("❌ Cannot detect sender number.");

        const userNumber = senderId.split("@")[0];
        const pairNumber = userNumber.replace(/[^0-9]/g, "");

        if (activeSockets.has(pairNumber)) {
            return reply("❌ *This bot is already paired with another device.*");
        }

        // ✅ Send starting message
        await socket.sendMessage(senderId, {
            text: `🔄 *FREE BOT PAIRING INITIATED*\n\nGenerating code for *${pairNumber}*...`
        }, { quoted: msg });

        // ✅ Mock response for EmpirePair
        const mockRes = {
            headersSent: false,
            send: async (data) => {
                if (data.code) {
                    // 1️⃣ Send the code first
                    await reply(`*${data.code}*`);

                    // 2️⃣ Then send setup instructions
                    await reply(
                        `📜 *Pairing Instructions*\n\n` +
                        `1️⃣ Copy the code above.\n` +
                        `2️⃣ Open *WhatsApp* on your phone.\n` +
                        `3️⃣ Go to *Settings > Linked Devices*.\n` +
                        `4️⃣ Tap *Link with Phone Number*.\n` +
                        `5️⃣ Paste the code & connect.\n\n` +
                        `⏳ *Note: Code expires in 1 minute*`
                    );
                }
            },
            status: () => mockRes
        };

        // ✅ Generate using EmpirePair (built-in, no external URL)
        await EmpirePair(pairNumber, mockRes);

    } catch (error) {
        console.error("❌ Freebot command error:", error);
        await socket.sendMessage(m.key.remoteJid, { 
            text: "❌ An error occurred. Please try again later." 
        }, { quoted: msg });
    }
    break;
}

case 'getdp': {
    try {
        let q = msg.message?.conversation?.split(" ")[1] || 
                msg.message?.extendedTextMessage?.text?.split(" ")[1];

        if (!q) return await socket.sendMessage(sender, { text: "❌ Please provide a number.\n\nUsage: .getdp <number>" });

        // 🔹 Format number into JID
        let jid = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";

        // 🔹 Try to get profile picture
        let ppUrl;
        try {
            ppUrl = await socket.profilePictureUrl(jid, "image");
        } catch {
            ppUrl = "https://i.ibb.co/zVRCwXKX/default-avatar-profile-icon-vector-unknown-social-media-user-photo-default-avatar-profile-icon-vecto.jpg"; // default dp
        }

        // 🔹 Send DP with botName meta mention
        await socket.sendMessage(sender, { 
            image: { url: ppUrl }, 
            caption: `🖼 *Profile Picture Found*\n\n*User:* ${q}\n`,
            buttons: [{ buttonId: `${prefix}menu`, buttonText: { displayText: "MAIN MENU" }, type: 1 }],
            headerType: 4
        }, { quoted: myquoted }); // <-- botName meta mention

    } catch (e) {
        console.log("❌ getdp error:", e);
        await socket.sendMessage(sender, { text: "⚠️ Error: Could not fetch profile picture." });
    }
    break;
}
              
case 'ping': {
    const start = Date.now();

    // Send a temporary message to measure delay
    const tempMsg = await socket.sendMessage(m.chat, { text: '```Pinging...```' });

    const end = Date.now();
    const ping = end - start;

    // Edit the message to show the result
    await socket.sendMessage(m.chat, {
        text: `*♻️ Speed... : ${ping} ms*`,
        edit: tempMsg.key
    });
    break;
}

case 'hack': {
    try {
    const steps = [
            '💻 *JANI-MD HACK STARTING...* 💻',
            '',
            '*Initializing hacking tools...* 🛠️',
            '*Connecting to remote servers...* 🌐',
            '',
            '```[██████████] 10%``` ⏳'                                            ,
            '```[████████████████████] 20%``` ⏳'                                   ,
            '```[██████████████████████████████] 30%``` ⏳'                               ,
            '```[████████████████████████████████████████] 40%``` ⏳'                            ,
            '```[██████████████████████████████████████████████████] 50%``` ⏳'                       ,
            '```[████████████████████████████████████████████████████████████] 60%``` ⏳'                 ,
            '```[██████████████████████████████████████████████████████████████████████] 70%``` ⏳'            ,
            '```[████████████████████████████████████████████████████████████████████████████████] 80%``` ⏳'        ,
            '```[██████████████████████████████████████████████████████████████████████████████████████████] 90%``` ⏳'    ,
            '```[████████████████████████████████████████████████████████████████████████████████████████████████████] 100%``` ✅',
            '',
            '🔒 *System Breach: Successful!* 🔓',
            '🚀 *Command Execution: Complete!* 🎯',
            '',
            '*📡 Transmitting data...* 📤',
            '*🕵️‍♂️ Ensuring stealth...* 🤫',
            '*🔧 Finalizing operations...* 🏁',
            '*🔧 DEW-MD Get Your All Data...* 🎁',
            '',
            '⚠️ *Note:* All actions are for demonstration purposes only.',
            '⚠️ *Reminder:* Ethical hacking is the only way to ensure security.',
            '⚠️ *Reminder:* Strong hacking is the only way to ensure security.',
            '',
            ' *👨‍💻 YOUR DATA HACK SUCCESSFULLY 👩‍💻☣*'
        ];

        for (const line of steps) {
            await socket.sendMessage(from, { text: line }, { quoted: msg });
            await new Promise(resolve => setTimeout(resolve, 1000)); // Adjust the delay as needed
        }
    } catch (e) {
        console.log(e);
        reply(`❌ *Error!* ${e.message}`);
    }
    break
}


// Owner Contact Command - Send Owner Contact and Video Note - Last Update 2025-August-14
case 'owner': {
    const ownerNamePlain = "JANI MD OWNER";
    const ownerNumber = "94761427943"; // without '+'
    const displayNumber = "+94 77 882 567 21";
    const email = "madhushasanduni53@gmail.com";

    // 2️⃣ Send vCard contact
    const vcard =
        'BEGIN:VCARD\n' +
        'VERSION:3.0\n' +
        `FN:${ownerNamePlain}\n` +
        `ORG:${ownerNamePlain}\n` +
        `TEL;type=CELL;type=VOICE;waid=${ownerNumber}:${displayNumber}\n` +
        `EMAIL:${email}\n` +
        'END:VCARD';

    await socket.sendMessage(sender, {
        contacts: {
            displayName: ownerNamePlain,
            contacts: [{ vcard }]
        }
    },{ quoted: myquoted });

    // 3️⃣ Send premium styled message
    const msgText = `*This Is JANI MD Owner Contact*
    `.trim();

    await socket.sendMessage(sender, { text: msgText });

    break;
}

                case 'deleteme': {
                    const userJid = jidNormalizedUser(socket.user.id);
                    const userNumber = userJid.split('@')[0];

                    if (userNumber !== number) {
                        return await socket.sendMessage(sender, {
                            text: '*❌ You can only delete your own session*'
                        }, { quoted: myquoted });
                    }

                    await socket.sendMessage(sender, {
                        image: { url: logo },
                        caption: formatMessage(
                            '🗑️ *SESSION DELETION*',
                            `⚠️ Your session will be permanently deleted!\n\n🔢 Number: ${number}\n\n*This action cannot be undone!*`,
                            `${footer}`
                        )
                    }, { quoted: myquoted });

                    setTimeout(async () => {
                        await deleteSessionImmediately(number);
                        socket.ws.close();
                        activeSockets.delete(number);
                    }, 3000);

                    break;
                }

                case 'vv':
                case 'viewonce': {
                    try {
                        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

                        if (!quotedMsg) {
                            return await socket.sendMessage(sender, {
                                text: '❌ *Please reply to a ViewOnce message!*\n\n📌 Usage: Reply to a viewonce message with `.vv`'
                            }, { quoted: myquoted });
                        }

                        await socket.sendMessage(sender, {
                            react: { text: '✨', key: msg.key }
                        });

                        let mediaData = null;
                        let mediaType = null;
                        let caption = '';

                        // Check for viewonce media
                        if (quotedMsg.imageMessage?.viewOnce) {
                            mediaData = quotedMsg.imageMessage;
                            mediaType = 'image';
                            caption = mediaData.caption || '';
                        } else if (quotedMsg.videoMessage?.viewOnce) {
                            mediaData = quotedMsg.videoMessage;
                            mediaType = 'video';
                            caption = mediaData.caption || '';
                        } else if (quotedMsg.viewOnceMessage?.message?.imageMessage) {
                            mediaData = quotedMsg.viewOnceMessage.message.imageMessage;
                            mediaType = 'image';
                            caption = mediaData.caption || '';
                        } else if (quotedMsg.viewOnceMessage?.message?.videoMessage) {
                            mediaData = quotedMsg.viewOnceMessage.message.videoMessage;
                            mediaType = 'video';
                            caption = mediaData.caption || '';
                        } else if (quotedMsg.viewOnceMessageV2?.message?.imageMessage) {
                            mediaData = quotedMsg.viewOnceMessageV2.message.imageMessage;
                            mediaType = 'image';
                            caption = mediaData.caption || '';
                        } else if (quotedMsg.viewOnceMessageV2?.message?.videoMessage) {
                            mediaData = quotedMsg.viewOnceMessageV2.message.videoMessage;
                            mediaType = 'video';
                            caption = mediaData.caption || '';
                        } else {
                            return await socket.sendMessage(sender, {
                                text: '❌ *This is not a ViewOnce message or it has already been viewed!*'
                            }, { quoted: myquoted });
                        }

                        if (mediaData && mediaType) {
                            await socket.sendMessage(sender, {
                                text: '⏳ *Retrieving ViewOnce media...*'
                            }, { quoted: myquoted });

                            const buffer = await downloadAndSaveMedia(mediaData, mediaType);

                            const messageContent = caption ?
                                `✅ *ViewOnce ${mediaType} Retrieved*\n\n📝 Caption: ${caption}` :
                                `✅ *ViewOnce ${mediaType} Retrieved*`;

                            if (mediaType === 'image') {
                                await socket.sendMessage(sender, {
                                    image: buffer,
                                    caption: messageContent
                                }, { quoted: myquoted });
                            } else if (mediaType === 'video') {
                                await socket.sendMessage(sender, {
                                    video: buffer,
                                    caption: messageContent
                                }, { quoted: myquoted });
                            }

                            await socket.sendMessage(sender, {
                                react: { text: '✅', key: msg.key }
                            });

                            console.log(`✅ ViewOnce ${mediaType} retrieved for ${sender}`);
                        }

                    } catch (error) {
                        console.error('ViewOnce Error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *Failed to retrieve ViewOnce*\n\nError: ${error.message}`
                        }, { quoted: myquoted });
                    }
                    break;
                }

                case 'count': {
                    try {
                        const activeCount = activeSockets.size;
                        const pendingCount = pendingSaves.size;
                        const healthyCount = Array.from(sessionHealth.values()).filter(h => h === 'active' || h === 'connected').length;
                        const reconnectingCount = Array.from(sessionHealth.values()).filter(h => h === 'reconnecting').length;
                        const failedCount = Array.from(sessionHealth.values()).filter(h => h === 'failed' || h === 'error').length;

                        // Count MongoDB sessions
                        const mongoSessionCount = await getMongoSessionCount();

                        // Get uptimes
                        const uptimes = [];
                        activeSockets.forEach((socket, number) => {
                            const startTime = socketCreationTime.get(number);
                            if (startTime) {
                                const uptime = Date.now() - startTime;
                                uptimes.push({
                                    number,
                                    uptime: Math.floor(uptime / 1000)
                                });
                            }
                        });

                        uptimes.sort((a, b) => b.uptime - a.uptime);

                        const uptimeList = uptimes.slice(0, 5).map((u, i) => {
                            const hours = Math.floor(u.uptime / 3600);
                            const minutes = Math.floor((u.uptime % 3600) / 60);
                            return `${i + 1}. ${u.number} - ${hours}h ${minutes}m`;
                        }).join('\n');

                        await socket.sendMessage(sender, {
                            image: { url: logo },
                            caption: formatMessage(
                                '📊 *JANI-MD Whatsapp Bot*',
                                `🟢 *Active Sessions:* ${activeCount}\n` +
                                `✅ *Healthy:* ${healthyCount}\n` +
                                `🔄 *Reconnecting:* ${reconnectingCount}\n` +
                                `❌ *Failed:* ${failedCount}\n` +
                                `💾 *Pending Saves:* ${pendingCount}\n` +
                                `☁️ *MongoDB Sessions:* ${mongoSessionCount}\n` +
                                `☁️ *MongoDB Status:* ${mongoConnected ? '✅ Connected' : '❌ Not Connected'}\n\n` +
                                `⏱️ *Top 5 Longest Running:*\n${uptimeList || 'No sessions running'}\n\n` +
                                `📅 *Report Time:* ${getSriLankaTimestamp()}`,
                                `${footer}`
                            )
                        }, { quoted: myquoted });

                    } catch (error) {
                        console.error('❌ Count error:', error);
                        await socket.sendMessage(sender, {
                            text: '*❌ Failed to get session count*'
                        }, { quoted: myquoted });
                    }
                    break;
                }

            case 'yts': {
                try {
                    if (!args[0]) {
                        return await reply('*❌ Please provide a search query*\n*Usage:* .yts <search term>');
                    }

                    const query = args.join(' ');
                    await reply(`*Searching YouTube for "${query}"...*`);
                    await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

                    const searchResults = await yts(query);

                    if (!searchResults || !searchResults.videos || searchResults.videos.length === 0) {
                        return await reply(`*❌ No results found for:* ${query}`);
                    }

                    const videos = searchResults.videos.slice(0, 10); // Get top 10 results

                    // Build rows for the interactive menu
                    const rows = videos.map(video => ({
                        title: video.title,
                        description: `[${video.timestamp}] by ${video.author.name}`,
                        id: `${prefix}play ${video.url}` // Trigger the play command on selection
                    }));

                    const menuCaption = `*JANI-MD YOUTUBE SEARCH*\n\n` +
                                        `*Query:* ${query}\n` +
                                        `*Results:* Found ${videos.length} videos.\n\n` +
                                        `*Tap an option below to download.*`;

                    // Send the interactive button menu
                    await socket.sendMessage(from, {
                        image: { url: videos[0].thumbnail },
                        caption: menuCaption,
                        footer: footer,
                        buttons: [
                            {
                                buttonId: 'action',
                                buttonText: { displayText: '📂 View Search Results' },
                                type: 4, // NativeFlow button
                                nativeFlowInfo: {
                                    name: 'single_select',
                                    paramsJson: JSON.stringify({
                                        title: 'YouTube Search Results ❏',
                                        sections: [{
                                            title: 'Top 10 Videos',
                                            rows: rows
                                        }]
                                    })
                                }
                            }
                        ],
                        headerType: 4, // Image header
                        contextInfo: contextInfo2
                    }, { quoted: myquoted });

                } catch (error) {
                    console.error('❌ YouTube search error:', error);
                    await reply(`*❌ Search failed*\n*Error:* ${error.message}`);
                }
                break;
            }
                       

case 'xnxx':
case 'xvideo':
case 'ph':
case 'xvdl': {
    try {
        const useButton = userConfig.BUTTON === 'true';

        const axios = require('axios');

        if (!args[0]) {
            await socket.sendMessage(sender, { text: 'Please provide a search query.' });
            break;
        }

        // 1️⃣ Search for the video
        const searchResult = await axios.get(`${apibase}/search/xnxx/search?apikey=${apikey}&q=${encodeURIComponent(args[0])}`);
        const videos = searchResult.data.result;

        if (!videos || videos.length === 0) {
            await socket.sendMessage(sender, { text: 'No results found.' });
            break;
        }

        const firstVideo = videos[0];

        // 2️⃣ Get download details
        const detailsResult = await axios.get(`${apibase}/download/xnxx/dl?apikey=${apikey}&url=${encodeURIComponent(firstVideo.link)}`);
        const video = detailsResult.data.result;

        // 3️⃣ Build message
        const caption = `◈ *X VIDEO DOWNLOADER*\n\n`+
                        `◈=======================◈\n`+
                        `╭──────────────╮\n`+
                        `┃ 🎞\`Title\`: \`${video.title}\`\n`+
                        `┃ ⏱\`Duration\`: ${video.duration} sec\n`+
                        `╰──────────────╯\n\n`;

        const select = `*Download Options:*\n\n`+
                        `1 │❯❯◦ Low Quality\n`+
                        `2 │❯❯◦ High Quality\n`+
                        `\n${footer}`;
        // 4️⃣ Send thumbnail + caption
    if (useButton) {
            await socket.sendMessage(sender, {
                image: { url: video.files.thumb },
                caption: caption+footer,
                buttons: [
            { buttonId: `${prefix}xvdlsd ${video.files.low}`, buttonText: { displayText: 'Download SD' }, type: 1 },
            { buttonId: `${prefix}xvdlhd ${video.files.high}`, buttonText: { displayText: 'Download HD' }, type: 1 },
                ]
        },{ quoted: myquoted });
    
    } else {
        const sentMsg = await socket.sendMessage(sender, {
            image: { url: video.files.thumb },
            caption : caption+select
        },{ quoted: myquoted });
        // 5️⃣ Wait for reply
        const xvdlHandler = async (mUpdate) => {
            try {
                const rMsg = mUpdate.messages[0];
                if (!rMsg?.message?.extendedTextMessage) return;

                // ensure reply belongs to our sent message
                const replyTo = rMsg.message.extendedTextMessage.contextInfo?.stanzaId;
                if (!replyTo) return;
                if (replyTo !== sentMsg.key.id) return;

                const selected = rMsg.message.extendedTextMessage.text.trim();

                if (selected === '1' || selected === '2') {
                    await socket.sendMessage(sender, { react: { text: '⬇️', key: sentMsg.key } });

                    const vidUrl = selected === '1' ? video.files.low : video.files.high;

                    await socket.sendMessage(sender, {
                        video: { url: vidUrl },
                        caption: `🎬 *${video.title || "Untitled Video"}*\n\n${footer}`
                    }, { quoted: sentMsg });

                    await socket.sendMessage(sender, { react: { text: '✅', key: sentMsg.key } });
                } else {
                    await socket.sendMessage(sender, { text: '❌ Invalid option. Reply with 1 or 2.', quoted: sentMsg });
                }
                socket.ev.off('messages.upsert', xvdlHandler); // Unregister listener
            } catch (err) {
                console.error("Reply handler error:", err);
              }
        };
        socket.ev.on('messages.upsert', xvdlHandler);
    }
    } catch (error) {
        console.error('Error in xvdl:', error.message);
        await socket.sendMessage(sender, { text: 'Failed to fetch video. Please try again later.' });
    }

    break;
}
case 'xvdlsd': {
    const url = args[0]; // buttonId passed like downloadhd_<url>
    if (!url) return await socket.sendMessage(from, { text: "❌ Invalid video URL" });

    try {
        // React immediately
        await socket.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

        // Send video as fast as possible
        await socket.sendMessage(from, {
            video:{url},      
            caption :`${footer}`
            }, {quoted:msg})   
        // React after sending
        await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(from, { text: "*❌ Error occurred while downloading video.*" });
    }
    break;
}
case 'xvdlhd': {
    const url = args[0]; // buttonId passed like downloadhd_<url>
    if (!url) return await socket.sendMessage(from, { text: "❌ Invalid video URL" });

    try {
        // React immediately
        await socket.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

        // Send video as fast as possible
        await socket.sendMessage(from, {
            video:{url: url},   
            caption :`${footer}`
            }, {quoted:msg})   
        // React after sending
        await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(from, { text: "*❌ Error occurred while downloading video.*" });
    }
    break;
}

default:
// Unknown command
break;
}
} catch (error) {
    console.error('❌ Command handler error:', error);
    await socket.sendMessage(sender, {
        image: { url: logo },
        caption: formatMessage(
            '❌ COMMAND ERROR HANDLER',
            'An error occurred but auto-recovery is active. Please try again.',
            `${footer}`
        )
    }
);}});}

function setupMessageHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        sessionHealth.set(sanitizedNumber, 'active');

        if (msg.key.remoteJid.endsWith('@s.whatsapp.net')) {
            await handleUnknownContact(socket, number, msg.key.remoteJid);
        }

        if (config.AUTO_RECORDING === 'true') {
            try {
                if (socket.ws.readyState === 1) { // 1 means OPEN
                    await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                }
            } catch (error) {
                console.error('❌ Failed to set recording presence:', error);
            }
        }
    });
}

function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        sessionConnectionStatus.set(sanitizedNumber, connection);

        if (connection === 'close') {
            disconnectionTime.set(sanitizedNumber, Date.now());
            sessionHealth.set(sanitizedNumber, 'disconnected');
            sessionConnectionStatus.set(sanitizedNumber, 'closed');

            if (lastDisconnect?.error?.output?.statusCode === 401) {
                console.log(`❌ Session invalidated for ${number}, deleting immediately`);
                sessionHealth.set(sanitizedNumber, 'invalid');
                await updateSessionStatus(sanitizedNumber, 'invalid', new Date().toISOString());
                await updateSessionStatusInMongoDB(sanitizedNumber, 'invalid', 'invalid');

                setTimeout(async () => {
                    await deleteSessionImmediately(sanitizedNumber);
                }, config.IMMEDIATE_DELETE_DELAY);
            } else {
                console.log(`🔄 Connection closed for ${number}, attempting reconnect...`);
                sessionHealth.set(sanitizedNumber, 'reconnecting');
                await updateSessionStatus(sanitizedNumber, 'failed', new Date().toISOString(), {
                    disconnectedAt: new Date().toISOString(),
                    reason: lastDisconnect?.error?.message || 'Connection closed'
                });
                await updateSessionStatusInMongoDB(sanitizedNumber, 'disconnected', 'reconnecting');

                const attempts = reconnectionAttempts.get(sanitizedNumber) || 0;
                if (attempts < config.MAX_FAILED_ATTEMPTS) {
                    await delay(10000);
                    activeSockets.delete(sanitizedNumber);

                    const mockRes = { headersSent: false, send: () => { }, status: () => mockRes };
                    await EmpirePair(number, mockRes);
                } else {
                    console.log(`❌ Max reconnection attempts reached for ${number}, deleting...`);
                    setTimeout(async () => {
                        await deleteSessionImmediately(sanitizedNumber);
                    }, config.IMMEDIATE_DELETE_DELAY);
                }
            }
        } else if (connection === 'open') {
            console.log(`✅ Connection open: ${number}`);
            sessionHealth.set(sanitizedNumber, 'active');
            sessionConnectionStatus.set(sanitizedNumber, 'open');
            reconnectionAttempts.delete(sanitizedNumber);
            disconnectionTime.delete(sanitizedNumber);
            await updateSessionStatus(sanitizedNumber, 'active', new Date().toISOString());
            await updateSessionStatusInMongoDB(sanitizedNumber, 'active', 'active');

            setTimeout(async () => {
                await autoSaveSession(sanitizedNumber);
            }, 5000);
        } else if (connection === 'connecting') {
            sessionHealth.set(sanitizedNumber, 'connecting');
            sessionConnectionStatus.set(sanitizedNumber, 'connecting');
        }
    });
}

// **MAIN PAIRING FUNCTION**

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(config.SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    console.log(`🔄 Connecting: ${sanitizedNumber}`);

    try {
        fs.ensureDirSync(sessionPath);

        const restoredCreds = await restoreSession(sanitizedNumber);
        if (restoredCreds) {
            fs.writeFileSync(
                path.join(sessionPath, 'creds.json'),
                JSON.stringify(restoredCreds, null, 2)
            );
            console.log(`✅ Session restored: ${sanitizedNumber}`);
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: ["Ubuntu", "Chrome", "20.0.04"] 
        });

        socketCreationTime.set(sanitizedNumber, Date.now());
        sessionHealth.set(sanitizedNumber, 'connecting');
        sessionConnectionStatus.set(sanitizedNumber, 'connecting');

        setupStatusHandlers(socket);
        setupStatusSavers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket, sanitizedNumber);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;

            while (retries > 0) {
                try {
                    await delay(1500);
                    pair = "DEWMDOFC"
                    code = await socket.requestPairingCode(sanitizedNumber, pair);
                    console.log(`📱 Generated pairing code for ${sanitizedNumber}: ${code}`);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`⚠️ Pairing code generation failed, retries: ${retries}`);
                    if (retries === 0) throw error;
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }

            if (!res.headersSent && code) {
                res.send({ code });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();

            if (isSessionActive(sanitizedNumber)) {
                try {
                    /*const fileContent = await fs.readFile(
                        path.join(sessionPath, 'creds.json'),
                        'utf8'
                    //);
                    //const credData = JSON.parse(fileContent);

                    // Save to MongoDB
                    //await saveSessionToMongoDB(sanitizedNumber, credData);
                    
                    console.log(`💾 Active session credentials updated: ${sanitizedNumber}`);
                */} catch (error) {
                    console.error(`❌ Failed to save credentials for ${sanitizedNumber}:`, error);
                }
            }
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;

            if (connection === 'open') {
                try {
                    await delay(3000);
                    let userConfig = await loadUserConfigFromMongoDB(sanitizedNumber);
                    if (!userConfig) {
                        await updateUserConfig(sanitizedNumber, config);
                        userConfig = config;
                    }

                    const userJid = jidNormalizedUser(socket.user.id);
                    await updateAboutStatus(socket);

                    activeSockets.set(sanitizedNumber, socket);
                    socket.userConfig = userConfig; // Attach user config to the socket
                    sessionHealth.set(sanitizedNumber, 'active');
                    sessionConnectionStatus.set(sanitizedNumber, 'open');
                    disconnectionTime.delete(sanitizedNumber);
                    restoringNumbers.delete(sanitizedNumber);

                    // Check if initial messages have been sent from the database
                    const sessionDoc = await Session.findOne({ number: sanitizedNumber });
                    if (!sessionDoc || !sessionDoc.initialMessagesSent) {
                        console.log(`🚀 Sending initial welcome messages for ${sanitizedNumber}...`);

                        // Send welcome message to user
                        try {
                            await socket.sendMessage(userJid, {
                                image: { url: logo },
                                caption: formatMessage(
                                    '*JANI-MD-Whatsapp Bot*',
                                    `Connect - ${mainSite}\n🤖 Auto-connected successfully!\n\n🔢 Number: ${sanitizedNumber}\n🍁 Channel: Auto-followed\n🔄 Auto-Reconnect: Active\n🧹 Auto-Cleanup: Inactive Sessions\n☁️ Storage: MongoDB (${mongoConnected ? 'Connected' : 'Connecting...'})\n📋 Pending Saves: ${pendingSaves.size}\n\n📋 Commands:\n📌${config.PREFIX}alive - Session status\n📌${config.PREFIX}menu - Show all commands`,
                                    `${footer}`
                                )
                            });

                            // Send message to admins
                            await sendAdminConnectMessage(socket, sanitizedNumber);

                            // Update the flag in the database only after successful sending
                            await Session.updateOne({ number: sanitizedNumber }, { $set: { initialMessagesSent: true } }, { upsert: true });
                            console.log(`✅ Initial messages sent and flag updated for ${sanitizedNumber}.`);
                        } catch (msgError) {
                            console.error(`❌ Failed to send initial message to ${sanitizedNumber}:`, msgError);
                        }

                    } else {
                        console.log(`⏭️ Skipping initial welcome messages for ${sanitizedNumber} (already sent).`);
                    }

                    // Auto-follow newsletters on every connection
                    for (const newsletterJid of config.NEWSLETTER_JIDS) {
                        try {
                            await socket.newsletterFollow(newsletterJid);
                        } catch (error) {
                            // Ignore if already following
                        }
                    }

                    await updateSessionStatus(sanitizedNumber, 'active', new Date().toISOString());
                    await updateSessionStatusInMongoDB(sanitizedNumber, 'active', 'active');
                    
                    let numbers = [];
                    if (fs.existsSync(config.NUMBER_LIST_PATH)) {
                        numbers = JSON.parse(fs.readFileSync(config.NUMBER_LIST_PATH, 'utf8'));
                    }
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        fs.writeFileSync(config.NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                    }

                    //console.log(`✅ Session fully connected and active: ${sanitizedNumber}`);
                } catch (error) {
                    console.error('❌ Connection setup error:', error);
                    sessionHealth.set(sanitizedNumber, 'error');
                }
            }
        });

        return socket;
    } catch (error) {
        console.error(`❌ Pairing error for ${sanitizedNumber}:`, error);
        sessionHealth.set(sanitizedNumber, 'failed');
        sessionConnectionStatus.set(sanitizedNumber, 'failed');
        disconnectionTime.set(sanitizedNumber, Date.now());
        restoringNumbers.delete(sanitizedNumber);

        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable', details: error.message });
        }

        throw error;
    }
}

// **API ROUTES**

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');  
           if (activeSockets.has(sanitizedNumber)) {
        const isActive = isSessionActive(sanitizedNumber);
        return res.status(200).send({
            status: isActive ? 'already_connected' : 'reconnecting',
            message: isActive ? 'This number is already connected and active' : 'Session is reconnecting',
            health: sessionHealth.get(sanitizedNumber) || 'unknown',
            connectionStatus: sessionConnectionStatus.get(sanitizedNumber) || 'unknown',
            storage: 'MongoDB'
        });
    }

    await EmpirePair(number, res);
});

router.get('/api/active', (req, res) => {
    const activeNumbers = [];
    const healthData = {};

    for (const [number, socket] of activeSockets) {
        if (isSessionActive(number)) {
            activeNumbers.push(number);
            healthData[number] = {
                health: sessionHealth.get(number) || 'unknown',
                connectionStatus: sessionConnectionStatus.get(number) || 'unknown',
                uptime: socketCreationTime.get(number) ? Date.now() - socketCreationTime.get(number) : 0,
                lastBackup: lastBackupTime.get(number) || null,
                isActive: true
            };
        }
    }

    res.status(200).send({
        count: activeNumbers.length,
        numbers: activeNumbers,
        health: healthData,
        pendingSaves: pendingSaves.size,
        storage: `MongoDB (${mongoConnected ? 'Connected' : 'Not Connected'})`,
        autoManagement: 'active'
    });
});
/*
// Status endpoint to check server health and active sessions
router.get('/status', async (req, res) => {
    const start = Date.now();

    // Simulate ping time by delaying until send
    const uptime = process.uptime(); // server uptime in seconds
    const memoryUsage = process.memoryUsage().rss; // RAM usage
    const cpuLoad = os.loadavg()[0]; // 1-minute CPU load avg

    // activeSockets is your Map of sessions
    const sessionCount = activeSockets.size;

    res.status(200).send({
        online: true,
        ping: Date.now() - start + "ms",
        activesessions: sessionCount,
        uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
        memory: `${(memoryUsage / 1024 / 1024).toFixed(2)} MB`,
        cpuLoad: cpuLoad.toFixed(2),
        timestamp: new Date().toISOString()
    });
});

router.get('/ping', (req, res) => {
    const activeCount = Array.from(activeSockets.keys()).filter(num => isSessionActive(num)).length;

    res.status(200).send({
        status: 'active',
        message: 'AUTO SESSION MANAGER is running with MongoDB',
        activeSessions: activeCount,
        totalSockets: activeSockets.size,
        storage: `MongoDB (${mongoConnected ? 'Connected' : 'Not Connected'})`,
        pendingSaves: pendingSaves.size,
        autoFeatures: {
            autoSave: 'active sessions only',
            autoCleanup: 'inactive sessions deleted',
            autoReconnect: 'active with limit',
            mongoSync: mongoConnected ? 'active' : 'initializing'
        }
    });
});

router.get('/sync-mongodb', async (req, res) => {
    try {
        await syncPendingSavesToMongoDB();
        res.status(200).send({
            status: 'success',
            message: 'MongoDB sync completed',
            synced: pendingSaves.size
        });
    } catch (error) {
        res.status(500).send({
            status: 'error',
            message: 'MongoDB sync failed',
            error: error.message
        });
    }
});

router.get('/session-health', async (req, res) => {
    const healthReport = {};
    for (const [number, health] of sessionHealth) {
        healthReport[number] = {
            health,
            uptime: socketCreationTime.get(number) ? Date.now() - socketCreationTime.get(number) : 0,
            reconnectionAttempts: reconnectionAttempts.get(number) || 0,
            lastBackup: lastBackupTime.get(number) || null,
            disconnectedSince: disconnectionTime.get(number) || null,
            isActive: activeSockets.has(number)
        };
    }

    res.status(200).send({
        status: 'success',
        totalSessions: sessionHealth.size,
        activeSessions: activeSockets.size,
        pendingSaves: pendingSaves.size,
        storage: `MongoDB (${mongoConnected ? 'Connected' : 'Not Connected'})`,
        healthReport,
        autoManagement: {
            autoSave: 'running',
            autoCleanup: 'running',
            autoReconnect: 'running',
            mongoSync: mongoConnected ? 'running' : 'initializing'
        }
    });
});

router.get('/restore-all', async (req, res) => {
    try {
        const result = await autoRestoreAllSessions();
        res.status(200).send({
            status: 'success',
            message: 'Auto-restore completed',
            restored: result.restored,
            failed: result.failed
        });
    } catch (error) {
        res.status(500).send({
            status: 'error',
            message: 'Auto-restore failed',
            error: error.message
        });
    }
});

router.get('/cleanup', async (req, res) => {
    try {
        await autoCleanupInactiveSessions();
        res.status(200).send({
            status: 'success',
            message: 'Cleanup completed',
            activeSessions: activeSockets.size
        });
    } catch (error) {
        res.status(500).send({
            status: 'error',
            message: 'Cleanup failed',
            error: error.message
        });
    }
});

router.delete('/session/:number', async (req, res) => {
    try {
        const { number } = req.params;
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        if (activeSockets.has(sanitizedNumber)) {
            const socket = activeSockets.get(sanitizedNumber);
            socket.ws.close();
        }

        await deleteSessionImmediately(sanitizedNumber);

        res.status(200).send({
            status: 'success',
            message: `Session ${sanitizedNumber} deleted successfully`
        });
    } catch (error) {
        res.status(500).send({
            status: 'error',
            message: 'Failed to delete session',
            error: error.message
        });
    }
});

router.get('/mongodb-status', async (req, res) => {
    try {
        const mongoStatus = mongoose.connection.readyState;
        const states = {
            0: 'disconnected',
            1: 'connected',
            2: 'connecting',
            3: 'disconnecting'
        };

        const sessionCount = await getMongoSessionCount();

        res.status(200).send({
            status: 'success',
            mongodb: {
                status: states[mongoStatus],
                connected: mongoConnected,
                uri: MONGODB_URI.replace(/:[^:]*@/, ':****@'), // Hide password
                sessionCount: sessionCount
            }
        });
    } catch (error) {
        res.status(500).send({
            status: 'error',
            message: 'Failed to get MongoDB status',
            error: error.message
        });
    }
});

// ⚙️ SETTINGS ROUTES (GET + POST)
router.get('/settings/:number', async (req, res) => {
  try {
    const number = req.params.number.replace(/[^0-9]/g, '');
    const localPath = path.join(__dirname, 'setting', `${number}.json`);
    
    let config = await loadUserConfigFromMongoDB(number);
    
    if (!config && fs.existsSync(localPath)) {
      config = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    }

    if (!config) {
      return res.status(404).json({ error: 'No config found' });
    }

    res.json(config);
  } catch (err) {
    console.error('GET /settings error:', err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

router.post('/settings/:number', async (req, res) => {
  try {
    const number = req.params.number.replace(/[^0-9]/g, '');
    const newConfig = req.body; // Only changed fields
    const localPath = path.join(__dirname, 'setting', `${number}.json`);

    let existingConfig = await loadUserConfigFromMongoDB(number);
    if (!existingConfig && fs.existsSync(localPath)) {
      existingConfig = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    }

    // Ensure default structure
    if (!existingConfig) {
      existingConfig = {
        number,
        AUTO_VIEW_STATUS: "true",
        AUTO_LIKE_STATUS: "true",
        AUTO_RECORDING: "true",
        AUTO_LIKE_EMOJI: ["💗","🔥"],
        BUTTON: "true",
        PREFIX: "."
      };
    }

    // Merge only changed fields
    const mergedConfig = { ...existingConfig, ...newConfig };

    // Save merged config
    await saveUserConfigToMongoDB(number, mergedConfig);
    fs.ensureDirSync(path.join(__dirname, 'setting'));
    fs.writeFileSync(localPath, JSON.stringify(mergedConfig, null, 2));

    console.log(`✅ Config updated for ${number}`);
    res.json({ success: true, message: 'Settings updated successfully', config: mergedConfig });
  } catch (err) {
    console.error('POST /settings error:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});*/

// **CLEANUP AND PROCESS HANDLERS**

process.on('exit', async () => {
    console.log('🛑 Shutting down auto-management...');

    if (autoSaveInterval) clearInterval(autoSaveInterval);
    if (autoCleanupInterval) clearInterval(autoCleanupInterval);
    // if (autoReconnectInterval) clearInterval(autoReconnectInterval); // This is now removed
    if (autoRestoreInterval) clearInterval(autoRestoreInterval);
    if (mongoSyncInterval) clearInterval(mongoSyncInterval);

    // Save pending items
    await syncPendingSavesToMongoDB().catch(console.error);

    // Close all active sockets
    activeSockets.forEach((socket, number) => {
        try {
            socket.ws.close();
        } catch (error) {
            console.error(`Failed to close socket for ${number}:`, error);
        }
    });

    // Close MongoDB connection
    await mongoose.connection.close();

    console.log('✅ Shutdown complete');
});

process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    
    // Save all active sessions before shutdown
    await autoSaveAllActiveSessions();
    
    // Sync with MongoDB
    await syncPendingSavesToMongoDB();
    
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    
    // Save all active sessions before shutdown
    await autoSaveAllActiveSessions();
    
    // Sync with MongoDB
    await syncPendingSavesToMongoDB();
    
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught exception:', err);
    
    // Try to save critical data
    syncPendingSavesToMongoDB().catch(console.error);
    
    setTimeout(() => {
        exec(`pm2 restart ${process.env.PM2_NAME || 'dew-md-session'}`);
    }, 5000);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// MongoDB connection event handlers
mongoose.connection.on('connected', () => {
    console.log('✅ MongoDB connected');
    mongoConnected = true;
});

mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB connection error:', err);
    mongoConnected = false;
});

mongoose.connection.on('disconnected', () => {
    console.log('⚠️ MongoDB disconnected');
    mongoConnected = false;
    
    // Try to reconnect
    setTimeout(() => {
        initializeMongoDB();
    }, 5000);
});

// Initialize auto-management on module load
initializeAutoManagement();

// Log startup status
console.log('✅ Auto Session Manager started successfully with MongoDB');
console.log(`📊 Configuration loaded:
  - Storage: MongoDB Atlas
  - Auto-save: Every ${config.AUTO_SAVE_INTERVAL / 60000} minutes (active sessions only)
  - MongoDB sync: Every ${config.MONGODB_SYNC_INTERVAL / 60000} minutes (for pending saves)
  - Auto-restore: Every ${config.AUTO_RESTORE_INTERVAL / 3600000} hour(s)
  - Auto-cleanup: Every ${config.AUTO_CLEANUP_INTERVAL / 60000} minutes (deletes inactive)
  - Disconnected cleanup timeout: ${config.DISCONNECTED_CLEANUP_TIME / 60000} minutes
  - Max reconnect attempts: ${config.MAX_FAILED_ATTEMPTS}
  - Pending Saves: ${pendingSaves.size}
`);

// Export the router
module.exports = router;
