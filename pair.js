const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const cheerio = require('cheerio');
const { Octokit } = require('@octokit/rest');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const { sms, downloadMediaMessage } = require("./msg");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    S_WHATSAPP_NET
} = require('baileys');

const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'false',
    AUTO_LIKE_EMOJI: ['💋', '🍬', '🫆', '💗', '🎈', '🎉', '🥳', '❤️', '🧫', '🐭'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/BkjrMld0nic2dNeRwXWIi5',
    ADMIN_LIST_PATH: './admin.json',
    RCD_IMAGE_PATH: './sulabot.jpg',
    NEWSLETTER_JID: '120363421363503978@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    OWNER_NUMBER: '94760663483',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029Vb7GtMHAInPngEYONu0g'
};

const octokit = new Octokit({ auth: 'github token' });// ඔයා 𝚐𝚒𝚝𝚑𝚞𝚋 𝚝𝚘𝚔𝚎𝚗 එකක් අරන් ඒක දාන්න
const owner = 'your username';//𝚐𝚒𝚝𝚑𝚞𝚋 𝙰𝙲𝙲𝙾𝚄𝙽𝚃 එකේ 𝚞𝚜𝚎𝚗𝚊𝚖𝚎 දාන්න 
const repo = 'repo name';//𝚐𝚒𝚝𝚑𝚞𝚋 𝚛𝚎𝚙𝚘 එකක් හදලා ඒකේ නම දාන්න

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const otpStore = new Map();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}
// CREATE BY SULA MD
async function cleanDuplicateFiles(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith(`empire_${sanitizedNumber}_`) && file.name.endsWith('.json')
        ).sort((a, b) => {
            const timeA = parseInt(a.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            const timeB = parseInt(b.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            return timeB - timeA;
        });

        const configFiles = data.filter(file => 
            file.name === `config_${sanitizedNumber}.json`
        );

        if (sessionFiles.length > 1) {
            for (let i = 1; i < sessionFiles.length; i++) {
                await octokit.repos.deleteFile({
                    owner,
                    repo,
                    path: `session/${sessionFiles[i].name}`,
                    message: `Delete duplicate session file for ${sanitizedNumber}`,
                    sha: sessionFiles[i].sha
                });
                console.log(`Deleted duplicate session file: ${sessionFiles[i].name}`);
            }
        }

        if (configFiles.length > 0) {
            console.log(`Config file for ${sanitizedNumber} already exists`);
        }
    } catch (error) {
        console.error(`Failed to clean duplicate files for ${number}:`, error);
    }
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES;
    const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    if (!inviteCodeMatch) {
        console.error('Invalid group invite link format');
        return { status: 'failed', error: 'Invalid group invite link' };
    }
    const inviteCode = inviteCodeMatch[1];

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) {
                console.log(`Successfully joined group with ID: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message.includes('gone')) {
                errorMessage = 'Group invite link is invalid or expired';
            }
            console.warn(`Failed to join group, retries left: ${retries}`, errorMessage);
            if (retries === 0) {
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (config.MAX_RETRIES - retries));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const groupStatus = groupResult.status === 'success'
        ? `Joined (ID: ${groupResult.gid})`
        : `Failed to join group: ${groupResult.error}`;
    const caption = formatMessage(
        '👻 𝐂𝙾𝙽𝙽𝙴𝙲𝚃 𝐒𝚄𝙻𝙰 𝐌𝙳 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃 👻',
        `📞 Number: ${number}\n🩵 Status: Connected`,
        '𝐏𝙾𝚆𝙴𝚁𝙳 𝐁𝚈 𝐒𝚄𝙻𝙰 𝐌𝙳'
    );

    for (const admin of admins) {
        try {
            await socket.sendMessage(
                `${admin}@s.whatsapp.net`,
                {
                    image: { url: config.RCD_IMAGE_PATH },
                    caption
                }
            );
        } catch (error) {
            console.error(`Failed to send connect message to admin ${admin}:`, error);
        }
    }
}

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        '𝐏𝙾𝚆𝙴𝚁𝙳 𝐁𝚈 𝐒𝚄𝙻𝙰 𝐌𝙳'
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;

        const allNewsletterJIDs = await loadNewsletterJIDsFromRaw();
        const jid = message.key.remoteJid;

        if (!allNewsletterJIDs.includes(jid)) return;

        try {
            const emojis = ['🩵', '🔥', '😀', '👍', '🐭'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;

            if (!messageId) {
                console.warn('No newsletterServerId found in message:', message);
                return;
            }

            let retries = 3;
            while (retries-- > 0) {
                try {
                    await socket.newsletterReactMessage(jid, messageId.toString(), randomEmoji);
                    console.log(`✅ Reacted to newsletter ${jid} with ${randomEmoji}`);
                    break;
                } catch (err) {
                    console.warn(`❌ Reaction attempt failed (${3 - retries}/3):`, err.message);
                    await delay(1500);
                }
            }
        } catch (error) {
            console.error('⚠️ Newsletter reaction handler failed:', error.message);
        }
    });
}

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;

        try {
            if (config.AUTO_RECORDING === 'true' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }

            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
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

async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;

        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        
        const message = formatMessage(
            '🗑️ MESSAGE DELETED',
            `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`,
            '𝐒𝚄𝙻𝙰 𝐌𝙳 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃'
        );

        try {
            await socket.sendMessage(userJid, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: message
            });
            console.log(`Notified ${number} about message deletion: ${messageKey.id}`);
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}
async function oneViewmeg(socket, isOwner, msg ,sender) {
    if (isOwner) {  
    try {
    const akuru = sender
    const quot = msg
    if (quot) {
        if (quot.imageMessage?.viewOnce) {
            console.log("hi");
            let cap = quot.imageMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.imageMessage);
            await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
        } else if (quot.videoMessage?.viewOnce) {
            console.log("hi");
            let cap = quot.videoMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.videoMessage);
             await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });
        } else if (quot.audioMessage?.viewOnce) {
            console.log("hi");
            let cap = quot.audioMessage?.caption || "";
            let anu = await socke.downloadAndSaveMediaMessage(quot.audioMessage);
             await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
        } else if (quot.viewOnceMessageV2?.message?.imageMessage){
        
            let cap = quot.viewOnceMessageV2?.message?.imageMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.imageMessage);
             await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
            
        } else if (quot.viewOnceMessageV2?.message?.videoMessage){
        
            let cap = quot.viewOnceMessageV2?.message?.videoMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.videoMessage);
            await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });

        } else if (quot.viewOnceMessageV2Extension?.message?.audioMessage){
        
            let cap = quot.viewOnceMessageV2Extension?.message?.audioMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2Extension.message.audioMessage);
            await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
        }
        }        
        } catch (error) {
      }
    }

}

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

const type = getContentType(msg.message);
    if (!msg.message) return	
  msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
	const m = sms(socket, msg);
	const quoted =
        type == "extendedTextMessage" &&
        msg.message.extendedTextMessage.contextInfo != null
          ? msg.message.extendedTextMessage.contextInfo.quotedMessage || []
          : []
        const body = (type === 'conversation') ? msg.message.conversation 
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
    : ''; //𝚂𝚄𝙻𝙰 𝙼𝙳 𝙵𝚁𝙴𝙴 𝙼𝙸𝙽𝙸 𝙱𝙰𝚂𝙴
	 	let sender = msg.key.remoteJid;
	  const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid)
          const senderNumber = nowsender.split('@')[0]
          const developers = `${config.OWNER_NUMBER}`;
          const botNumber = socket.user.id.split(':')[0]
          const isbot = botNumber.includes(senderNumber)
          const isOwner = isbot ? isbot : developers.includes(senderNumber)
          var prefix = config.PREFIX
	  var isCmd = body.startsWith(prefix)
    	  const from = msg.key.remoteJid;
          const isGroup = from.endsWith("@g.us")
	      const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '.';
          var args = body.trim().split(/ +/).slice(1)
socket.downloadAndSaveMediaMessage = async(message, filename, attachExtension = true) => {
                let quoted = message.msg ? message.msg : message
                let mime = (message.msg || message).mimetype || ''
                let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0]
                const stream = await downloadContentFromMessage(quoted, messageType)
                let buffer = Buffer.from([])
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk])
                }
                let type = await FileType.fromBuffer(buffer)
                trueFileName = attachExtension ? (filename + '.' + type.ext) : filename
                await fs.writeFileSync(trueFileName, buffer)
                return trueFileName
}
        if (!command) return;
        
        let pinterestCache = {}; //

        try {
            switch (command) {
       case 'alive': {
  try {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);

    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;

    const usedMem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const totalMem = Math.round(os.totalmem() / 1024 / 1024);

    const aliveText = `
╭━━━〔 🤖 RAVIYA MD ALIVE 〕━━━╮
│ 🟢 Status : ONLINE
│ ⏱ Uptime : ${hours}h ${minutes}m ${seconds}s
│ 🧠 Memory : ${usedMem}MB / ${totalMem}MB
│ ⚙️ Prefix : ${config.PREFIX}
│ 👑 Owner : ${config.OWNER_NUMBER}
╰━━━━━━━━━━━━━━━━━━━━╯
`;

    await socket.sendMessage(m.chat, {
      image: { url: "https://files.catbox.moe/84288h.jpg" },
      caption: aliveText,
      buttons: [
        {
          buttonId: `${config.PREFIX}menu`,
          buttonText: { displayText: '📂 MENU' },
          type: 1
        },
        {
          buttonId: `${config.PREFIX}rect`,
          buttonText: { displayText: '🔲 RECT MENU' },
          type: 1
        },
        {
          buttonId: `${config.PREFIX}ping`,
          buttonText: { displayText: '🏓 PING' },
          type: 1
        }
      ],
      headerType: 1
    }, { quoted: m });

    await socket.sendMessage(m.chat, {
      react: { text: '🟢', key: m.key }
    });

  } catch (err) {
    console.error("Alive error:", err);
    await socket.sendMessage(m.chat, {
      text: "❌ Alive command failed!"
    }, { quoted: m });
  }
  break;
	   }
                case 'menu': {
    
    const captionText = `
➤ Available Commands..!! 🌐💭*\n\n┏━━━━━━━━━━━ ◉◉➢\n┇ *\`${config.PREFIX}alive\`*\n┋ • Show bot status\n┋\n┋ *\`${config.PREFIX}fancy\`*\n┋ • View Fancy Text\n┇\n┇ *\`${config.PREFIX}bomb\`*\n┇• Send Bomb Massage\n┇\n┇ *\`${config.PREFIX}deleteme\`*\n┇• Delete your session\n┋\n┗━━━━━━━━━━━ ◉◉➣
`;

    const templateButtons = [
        {
            buttonId: `${config.PREFIX}alive`,
            buttonText: { displayText: 'ALIVE' },
            type: 1,
        },
        {
            buttonId: `${config.PREFIX}owner`,
            buttonText: { displayText: 'OWNER' },
            type: 1,
        },
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
                            title: `𝐒𝚄𝙻𝙰 𝐌𝙳 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃`,
                            highlight_label: '',
                            rows: [
                                {
                                    title: 'CHECK BOT STATUS',
                                    description: '𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝚈 𝐒𝚄𝙻𝙰 𝐌𝙳',
                                    id: `${config.PREFIX}alive`,
                                },
                                {
                                    title: 'OWNER NUMBER',
                                    description: '𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝚈 𝐒𝚄𝙻𝙰 𝐌𝙳',
                                    id: `${config.PREFIX}owner`,
                                },
                            ],
                        },
                    ],
                }),
            },
        }
    ];

    await socket.sendMessage(m.chat, {
        buttons: templateButtons,
        headerType: 1,
        viewOnce: true,
        image: { url: "https://i.ibb.co/TDgzTB29/SulaMd.png" },
        caption: `𝐒𝚄𝙻𝙰 𝐌𝙳 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃 𝐋𝙸𝚂𝚃 𝐌𝙴𝙽𝚄\n\n${captionText}`,
    }, { quoted: msg });

    break;
}     
					case 'allmenu': {
  const menuText = `
╭━━━〔 🤖 RAVIYA MD FULL MENU 〕━━━╮

📌 GENERAL
• .alive
• .menu
• .rect
• .ping
• .bot_info
• .bot_stats

📥 DOWNLOAD
• .song
• .tiktok
• .fb
• .ig
• .video
• .yta
• .ytv

🎨 MEDIA
• .sticker
• .toimg
• .tomp3
• .getpp
• .viewonce

🤖 AI
• .ai
• .aiimg
• .chatgpt

🫂 GROUP
• .add
• .kick
• .promote
• .demote
• .tagall
• .open
• .close

📰 INFO
• .news
• .weather
• .cricket
• .nasa

🎉 FUN
• .joke
• .meme
• .fact
• .quote
• .roast

╰━━━━━━━━━━━━━━━━━━━━╯
© RAVIYA MD
`;

  await socket.sendMessage(m.chat, { text: menuText }, { quoted: m });
  break;
		}
					case 'rect': {
  const rectMenu = {
    title: "📦 JANI-MD MENU",
    sections: [
      {
        title: "⚙️ BOT COMMANDS",
        rows: [
          { title: "🟢 Alive", description: "Check bot status", id: ".alive" },
          { title: "📊 Bot Stats", description: "Bot performance", id: ".bot_stats" },
          { title: "ℹ️ Bot Info", description: "About the bot", id: ".bot_info" },
          { title: "📜 Full Menu", description: "Show all commands", id: ".allmenu" }
        ]
      },
      {
        title: "📥 DOWNLOAD",
        rows: [
          { title: "🎵 Song", description: "YouTube audio", id: ".song" },
          { title: "📹 TikTok", description: "TikTok downloader", id: ".tiktok" },
          { title: "📘 Facebook", description: "FB video downloader", id: ".fb" },
          { title: "📸 Instagram", description: "IG reels & posts", id: ".ig" }
        ]
      },
      {
        title: "🫂 GROUP",
        rows: [
          { title: "➕ Add", description: "Add member", id: ".add" },
          { title: "🦶 Kick", description: "Remove member", id: ".kick" },
          { title: "👑 Promote", description: "Make admin", id: ".promote" },
          { title: "😢 Demote", description: "Remove admin", id: ".demote" }
        ]
      }
    ]
  };

  await socket.sendMessage(m.chat, {
    text: "🔲 *JANI-MD RECT MENU*\nSelect a command below 👇",
    footer: "© JANI-MD",
    buttonText: "📂 OPEN MENU",
    sections: rectMenu.sections
  }, { quoted: m });

  break;
			}
					case 'ping': {
  try {
    const start = Date.now();

    await socket.sendMessage(m.chat, {
      text: "🏓 Pinging..."
    }, { quoted: m });

    const latency = Date.now() - start;

    let quality, emoji;
    if (latency < 100) {
      quality = "EXCELLENT";
      emoji = "🟢";
    } else if (latency < 300) {
      quality = "GOOD";
      emoji = "🟡";
    } else if (latency < 600) {
      quality = "FAIR";
      emoji = "🟠";
    } else {
      quality = "SLOW";
      emoji = "🔴";
    }

    const pingText = `
╭━━━〔 🏓 RAVIYA MD PING 〕━━━╮
│ ⚡ Speed : ${latency} ms
│ ${emoji} Quality : ${quality}
│ 🕒 Time : ${new Date().toLocaleString()}
╰━━━━━━━━━━━━━━━━━━━━╯
`;

    await socket.sendMessage(m.chat, {
      text: pingText,
      buttons: [
        {
          buttonId: `${config.PREFIX}alive`,
          buttonText: { displayText: '🟢 ALIVE' },
          type: 1
        },
        {
          buttonId: `${config.PREFIX}menu`,
          buttonText: { displayText: '📂 MENU' },
          type: 1
        },
        {
          buttonId: `${config.PREFIX}rect`,
          buttonText: { displayText: '🔲 RECT MENU' },
          type: 1
        }
      ],
      headerType: 1
    }, { quoted: m });

    await socket.sendMessage(m.chat, {
      react: { text: emoji, key: m.key }
    });

  } catch (err) {
    console.error("Ping error:", err);
    await socket.sendMessage(m.chat, {
      text: "❌ Ping failed!"
    }, { quoted: m });
  }
  break;
			}
		        case 'owner': {
    const ownerNumber = '+94761427943';
    const ownerName = 'Janith sathsara';
    const organization = '*JANI-𝐌𝐃* WHATSAPP BOT DEVALOPER 🍬';

    const vcard = 'BEGIN:VCARD\n' +
                  'VERSION:3.0\n' +
                  `FN:${ownerName}\n` +
                  `ORG:${organization};\n` +
                  `TEL;type=CELL;type=VOICE;waid=${ownerNumber.replace('+', '')}:${ownerNumber}\n` +
                  'END:VCARD';

    try {
        // Send vCard contact
        const sent = await socket.sendMessage(from, {
            contacts: {
                displayName: ownerName,
                contacts: [{ vcard }]
            }
        });

        // Then send message with reference
        await socket.sendMessage(from, {
            text: `*SULA-MD OWNER*\n\n👤 Name: ${ownerName}\n📞 Number: ${ownerNumber}\n\n> 𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝚈 𝐒𝚄𝙻𝙰 𝐌𝙳`,
            contextInfo: {
                mentionedJid: [`${ownerNumber.replace('+', '')}@s.whatsapp.net`],
                quotedMessageId: sent.key.id
            }
        }, { quoted: msg });

    } catch (err) {
        console.error('❌ Owner command error:', err.message);
        await socket.sendMessage(from, {
            text: '❌ Error sending owner contact.'
        }, { quoted: msg });
    }

    break;
}
              case 'aiimg': {
  const axios = require('axios');

  const q =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption || '';

  const prompt = q.trim();

  if (!prompt) {
    return await socket.sendMessage(sender, {
      text: '🎨 *Please provide a prompt to generate an AI image.*'
    });
  }

  try {
    // Notify that image is being generated
    await socket.sendMessage(sender, {
      text: '🧠 *Creating your AI image...*',
    });

    // Build API URL
    const apiUrl = `https://api.siputzx.my.id/api/ai/flux?prompt=${encodeURIComponent(prompt)}`;

    // Call the AI API
    const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });

    // Validate API response
    if (!response || !response.data) {
      return await socket.sendMessage(sender, {
        text: '❌ *API did not return a valid image. Please try again later.*'
      });
    }

    // Convert the binary image to buffer
    const imageBuffer = Buffer.from(response.data, 'binary');

    // Send the image
    await socket.sendMessage(sender, {
      image: imageBuffer,
      caption: `🧠 *SULA-MD AI IMAGE*\n\n📌 Prompt: ${prompt}`
    }, { quoted: msg });

  } catch (err) {
    console.error('AI Image Error:', err);

    await socket.sendMessage(sender, {
      text: `❗ *An error occurred:* ${err.response?.data?.message || err.message || 'Unknown error'}`
    });
  }

  break;
}
              case 'fancy': {
  const axios = require("axios");

  const q =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption || '';

  const text = q.trim().replace(/^.fancy\s+/i, ""); // remove .fancy prefix

  if (!text) {
    return await socket.sendMessage(sender, {
      text: "❎ *Please provide text to convert into fancy fonts.*\n\n📌 *Example:* `.fancy Sula`"
    });
  }

  try {
    const apiUrl = `https://www.dark-yasiya-api.site/other/font?text=${encodeURIComponent(text)}`;
    const response = await axios.get(apiUrl);

    if (!response.data.status || !response.data.result) {
      return await socket.sendMessage(sender, {
        text: "❌ *Error fetching fonts from API. Please try again later.*"
      });
    }

    // Format fonts list
    const fontList = response.data.result
      .map(font => `*${font.name}:*\n${font.result}`)
      .join("\n\n");

    const finalMessage = `🎨 *Fancy Fonts Converter*\n\n${fontList}\n\n_𝐏𝙾𝚆𝙴𝚁𝙳 𝐁𝚈 𝐒𝚄𝙻𝙰 𝐌𝙳_`;

    await socket.sendMessage(sender, {
      text: finalMessage
    }, { quoted: msg });

  } catch (err) {
    console.error("Fancy Font Error:", err);
    await socket.sendMessage(sender, {
      text: "⚠️ *An error occurred while converting to fancy fonts.*"
    });
  }

  break;
       }
       case 'fc': {
                    if (args.length === 0) {
                        return await socket.sendMessage(sender, {
                            text: '❗ Please provide a channel JID.\n\nExample:\n.fcn 120363396379901844@newsletter'
                        });
                    }

                    const jid = args[0];
                    if (!jid.endsWith("@newsletter")) {
                        return await socket.sendMessage(sender, {
                            text: '❗ Invalid JID. Please provide a JID ending with `@newsletter`'
                        });
                    }

                    try {
                        const metadata = await socket.newsletterMetadata("jid", jid);
                        if (metadata?.viewer_metadata === null) {
                            await socket.newsletterFollow(jid);
                            await socket.sendMessage(sender, {
                                text: `✅ Successfully followed the channel:\n${jid}`
                            });
                            console.log(`FOLLOWED CHANNEL: ${jid}`);
                        } else {
                            await socket.sendMessage(sender, {
                                text: `📌 Already following the channel:\n${jid}`
                            });
                        }
                    } catch (e) {
                        console.error('❌ Error in follow channel:', e.message);
                        await socket.sendMessage(sender, {
                            text: `❌ Error: ${e.message}`
                        });
                    }
                    break;
                }
					case 'botinfo':
case 'bot_info': {
  try {
    const infoText = `
╭━━━〔 🤖 RAVIYA MD BOT INFO 〕━━━╮
│ 🧠 Bot Name : RAVIYA MD
│ 👑 Owner : ${config.OWNER_NUMBER}
│ ⚙️ Prefix : ${config.PREFIX}
│ 📦 Version : ${config.version}
│ 🌐 Platform : Node.js + Baileys
│ 🕒 Time : ${new Date().toLocaleString()}
╰━━━━━━━━━━━━━━━━━━━━╯
`;

    await socket.sendMessage(m.chat, {
      image: { url: "https://files.catbox.moe/1b45ry.jpg" },
      caption: infoText,
      buttons: [
        {
          buttonId: `${config.PREFIX}alive`,
          buttonText: { displayText: '🟢 ALIVE' },
          type: 1
        },
        {
          buttonId: `${config.PREFIX}ping`,
          buttonText: { displayText: '🏓 PING' },
          type: 1
        },
        {
          buttonId: `${config.PREFIX}menu`,
          buttonText: { displayText: '📂 MENU' },
          type: 1
        }
      ],
      headerType: 1
    }, { quoted: m });

    await socket.sendMessage(m.chat, {
      react: { text: '🤖', key: m.key }
    });

  } catch (err) {
    console.error("Bot info error:", err);
    await socket.sendMessage(m.chat, {
      text: "❌ Failed to get bot info!"
    }, { quoted: m });
  }
  break;
}
					case 'botstats':
case 'bot_stats': {
  try {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);

    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;

    const usedMem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const totalMem = Math.round(os.totalmem() / 1024 / 1024);

    const activeBots = activeSockets.size || 1;
    const nodeVersion = process.version;

    const statsText = `
╭━━━〔 📊 RAVIYA MD BOT STATS 〕━━━╮
│ ⏱ Uptime : ${hours}h ${minutes}m ${seconds}s
│ 🧠 Memory : ${usedMem}MB / ${totalMem}MB
│ 🤖 Active Bots : ${activeBots}
│ ⚙️ Node.js : ${nodeVersion}
│ 📦 Version : ${config.version}
│ 🕒 Time : ${new Date().toLocaleString()}
╰━━━━━━━━━━━━━━━━━━━━╯
`;

    await socket.sendMessage(m.chat, {
      image: { url: "https://files.catbox.moe/1b45ry.jpg" },
      caption: statsText,
      buttons: [
        {
          buttonId: `${config.PREFIX}alive`,
          buttonText: { displayText: '🟢 ALIVE' },
          type: 1
        },
        {
          buttonId: `${config.PREFIX}ping`,
          buttonText: { displayText: '🏓 PING' },
          type: 1
        },
        {
          buttonId: `${config.PREFIX}menu`,
          buttonText: { displayText: '📂 MENU' },
          type: 1
        }
      ],
      headerType: 1
    }, { quoted: m });

    await socket.sendMessage(m.chat, {
      react: { text: '📊', key: m.key }
    });

  } catch (err) {
    console.error("Bot stats error:", err);
    await socket.sendMessage(m.chat, {
      text: "❌ Failed to fetch bot stats!"
    }, { quoted: m });
  }
  break;
			  }
					
                case 'pair': {
    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const number = q.replace(/^[.\/!]pair\s*/i, '').trim();

    if (!number) {
        return await socket.sendMessage(sender, {
            text: '*📌 Usage:* .pair +9476066XXXX'
        }, { quoted: msg });
    }

    try {
        const url = `https://sulamini-965f457bb5bc.herokuapp.com/code?number=${encodeURIComponent(number)}`;// heroku app link එක දාපන් 
        const response = await fetch(url);
        const bodyText = await response.text();

        console.log("🌐 API Response:", bodyText);

        let result;
        try {
            result = JSON.parse(bodyText);
        } catch (e) {
            console.error("❌ JSON Parse Error:", e);
            return await socket.sendMessage(sender, {
                text: '❌ Invalid response from server. Please contact support.'
            }, { quoted: msg });
        }

        if (!result || !result.code) {
            return await socket.sendMessage(sender, {
                text: '❌ Failed to retrieve pairing code. Please check the number.'
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            text: `> *𝐒𝚄𝙻𝙰 𝐌𝙳 𝐌𝙸𝙽𝙸 𝐁𝙾𝚃 𝐏𝙰𝙸𝚁 𝐂𝙾𝙼𝙿𝙻𝙴𝚃𝙴𝙳* ✅\n\n*🔑 Your pairing code is:* ${result.code}`
        }, { quoted: msg });

        await sleep(2000);

        await socket.sendMessage(sender, {
            text: `${result.code}`
        }, { quoted: msg });

    } catch (err) {
        console.error("❌ Pair Command Error:", err);
        await socket.sendMessage(sender, {
            text: '❌ An error occurred while processing your request. Please try again later.'
        }, { quoted: msg });
    }

    break;
} 
    case 'bomb': {
    const isOwner = senderNumber === config.OWNER_NUMBER;
    const isBotUser = activeSockets.has(senderNumber);

    if (!isOwner && !isBotUser) {
        return await socket.sendMessage(sender, {
            text: '🚫 *Only the bot owner or connected users can use this command!*'
        }, { quoted: msg });
    }

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text || '';
    const [target, text, countRaw] = q.split(',').map(x => x?.trim());

    const count = parseInt(countRaw) || 5;

    if (!target || !text || !count) {
        return await socket.sendMessage(sender, {
            text: '📌 *Usage:* .bomb <number>,<message>,<count>\n\nExample:\n.bomb 9476XXXXXXX,Hello 👋,5'
        }, { quoted: msg });
    }

    const jid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;

    if (count > 20) {
        return await socket.sendMessage(sender, {
            text: '❌ *Limit is 20 messages per bomb.*'
        }, { quoted: msg });
    }

    for (let i = 0; i < count; i++) {
        await socket.sendMessage(jid, { text });
        await delay(700); // delay to prevent spam
    }

    await socket.sendMessage(sender, {
        text: `✅ Bomb sent to ${target} — ${count}x`
    }, { quoted: msg });

    break;
}
					case 'ytv': {
  try {
    if (!args || args.length === 0) {
      return await socket.sendMessage(m.chat, {
        text: "❌ Please provide a YouTube video URL!\nExample: .ytv https://www.youtube.com/watch?v=XXXXXXXXX"
      }, { quoted: m });
    }

    const url = args[0];
    await socket.sendMessage(m.chat, { text: "📥 Downloading YouTube video..." }, { quoted: m });

    // Replace with your actual YouTube video download function
    const ytvResult = await downloadYouTubeVideo(url); // { videoUrl, title, thumbnail }

    if (!ytvResult) {
      return await socket.sendMessage(m.chat, { text: "❌ Failed to download YouTube video!" }, { quoted: m });
    }

    const ytvButtons = [
      {
        buttonId: `${config.PREFIX}ytv ${url}`,
        buttonText: { displayText: "📹 Download Video" },
        type: 1
      },
      {
        buttonId: `${config.PREFIX}yta ${url}`,
        buttonText: { displayText: "🎧 Download Audio" },
        type: 1
      },
      {
        buttonId: `${config.PREFIX}menu`,
        buttonText: { displayText: "📂 MENU" },
        type: 1
      }
    ];

    await socket.sendMessage(m.chat, {
      image: { url: ytvResult.thumbnail },
      caption: `📥 *YouTube Video*\n\nTitle: ${ytvResult.title}\nURL: ${url}`,
      footer: "© RAVIYA MD",
      buttons: ytvButtons,
      headerType: 4
    }, { quoted: m });

  } catch (err) {
    console.error("YouTube Video error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to download YouTube video!" }, { quoted: m });
  }
  break;
		}
					case 'sticker':
case 's': {
  try {
    // Check if the user sent media
    if (!m.quoted || (!m.quoted.image && !m.quoted.video)) {
      return await socket.sendMessage(m.chat, { 
        text: "❌ Please reply to an image or short video to convert it into a sticker!" 
      }, { quoted: m });
    }

    const media = m.quoted;

    // Download media buffer
    const stream = await socket.downloadMediaMessage(media);
    
    // Convert media to sticker (you can use your sticker creation function)
    const stickerBuffer = await createSticker(stream, {
      packname: "RAVIYA MD",
      author: "WhatsApp Bot"
    });

    await socket.sendMessage(m.chat, {
      sticker: stickerBuffer
    }, { quoted: m });

    await socket.sendMessage(m.chat, { 
      text: "✅ Sticker created successfully!" 
    }, { quoted: m });

  } catch (err) {
    console.error("Sticker error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to create sticker!" }, { quoted: m });
  }
  break;
		  }
					case 'toimg': {
  try {
    if (!m.quoted || !m.quoted.sticker) {
      return await socket.sendMessage(m.chat, { 
        text: "❌ Please reply to a sticker to convert it into an image!" 
      }, { quoted: m });
    }

    const sticker = m.quoted;

    // Download sticker buffer
    const stickerBuffer = await socket.downloadMediaMessage(sticker);

    // Convert sticker to image (PNG)
    const imageBuffer = await stickerToImage(stickerBuffer); // Use your sticker-to-image function

    await socket.sendMessage(m.chat, {
      image: imageBuffer,
      caption: "✅ Sticker converted to image successfully!"
    }, { quoted: m });

  } catch (err) {
    console.error("ToImg error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to convert sticker to image!" }, { quoted: m });
  }
  breaik;
  }
					case 'tomp3': {
  try {
    if (!m.quoted || (!m.quoted.video && !m.quoted.audio)) {
      return await socket.sendMessage(m.chat, { 
        text: "❌ Please reply to a video or audio to convert it into MP3!" 
      }, { quoted: m });
    }

    const media = m.quoted;

    // Download media buffer
    const mediaBuffer = await socket.downloadMediaMessage(media);

    // Convert media to MP3 (use your own converter function)
    const mp3Buffer = await convertToMP3(mediaBuffer); // e.g., ffmpeg conversion

    await socket.sendMessage(m.chat, {
      audio: mp3Buffer,
      mimetype: 'audio/mpeg',
      ptt: false,
      caption: "✅ Converted to MP3 successfully!"
    }, { quoted: m });

  } catch (err) {
    console.error("ToMP3 error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to convert media to MP3!" }, { quoted: m });
  }
  break;
			}
					case 'getpp': {
  try {
    let target = m.mentionedJid && m.mentionedJid[0] ? m.mentionedJid[0] : m.sender;

    await socket.sendMessage(m.chat, { text: "📥 Fetching profile picture..." }, { quoted: m });

    // Get profile picture URL
    const ppUrl = await socket.profilePictureUrl(target, 'image').catch(() => 'https://i.ibb.co/0jqHpnp/No-Image.png');

    const ppButtons = [
      {
        buttonId: `${config.PREFIX}menu`,
        buttonText: { displayText: "📂 MENU" },
        type: 1
      },
      {
        buttonId: `${config.PREFIX}alive`,
        buttonText: { displayText: "🟢 ALIVE" },
        type: 1
      }
    ];

    await socket.sendMessage(m.chat, {
      image: { url: ppUrl },
      caption: `📸 Profile Picture of @${target.split("@")[0]}`,
      footer: "© RAVIYA MD",
      buttons: ppButtons,
      mentions: [target],
      headerType: 4
    }, { quoted: m });

  } catch (err) {
    console.error("GetPP error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to fetch profile picture!" }, { quoted: m });
  }
  break;
		}
					case 'viewonce': {
  try {
    if (!m.quoted || !m.quoted.viewOnce) {
      return await socket.sendMessage(m.chat, { 
        text: "❌ Please reply to a view-once message (image/video)!" 
      }, { quoted: m });
    }

    // Download the view-once media
    const mediaBuffer = await socket.downloadMediaMessage(m.quoted);

    await socket.sendMessage(m.chat, {
      caption: "✅ View-once message saved!",
      image: m.quoted.mtype === 'image' ? mediaBuffer : undefined,
      video: m.quoted.mtype === 'video' ? mediaBuffer : undefined,
      mimetype: m.quoted.mimetype || undefined,
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📂 MENU" }, type: 1 },
        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: "🟢 ALIVE" }, type: 1 }
      ],
      footer: "© RAVIYA MD",
      headerType: 4
    }, { quoted: m });

  } catch (err) {
    console.error("ViewOnce error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to save view-once message!" }, { quoted: m });
  }
  break;
					 }
					case 'song': {
  try {
    if (!args || args.length === 0) {
      return await socket.sendMessage(m.chat, { text: "❌ Please provide a song name!\nExample: .song Shape of You" }, { quoted: m });
    }

    const query = args.join(" ");
    await socket.sendMessage(m.chat, { text: `🎵 Searching for: *${query}*...` }, { quoted: m });

    // Replace with your actual YouTube or song search function
    const songResult = await searchYouTubeAudio(query); // Assume this returns { title, url, thumbnail }

    if (!songResult) {
      return await socket.sendMessage(m.chat, { text: "❌ Song not found!" }, { quoted: m });
    }

    const songButtons = [
      {
        buttonId: `${config.PREFIX}yta ${songResult.url}`,
        buttonText: { displayText: "🎧 Download Audio" },
        type: 1
      },
      {
        buttonId: `${config.PREFIX}ytv ${songResult.url}`,
        buttonText: { displayText: "📹 Download Video" },
        type: 1
      },
      {
        buttonId: `${config.PREFIX}menu`,
        buttonText: { displayText: "📂 MENU" },
        type: 1
      }
    ];

    const songMessage = {
      image: { url: songResult.thumbnail },
      caption: `🎵 *Song Found!*\n\nTitle: ${songResult.title}\nURL: ${songResult.url}`,
      footer: "© RAVIYA MD",
      buttons: songButtons,
      headerType: 4
    };

    await socket.sendMessage(m.chat, songMessage, { quoted: m });

  } catch (err) {
    console.error("Song error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to fetch song!" }, { quoted: m });
  }
  break;
		}
					case 'tiktok': {
  try {
    if (!args || args.length === 0) {
      return await socket.sendMessage(m.chat, { 
        text: "❌ Please provide a TikTok video URL!\nExample: .tiktok https://www.tiktok.com/@user/video/1234567890" 
      }, { quoted: m });
    }

    const url = args[0];
    await socket.sendMessage(m.chat, { text: "🎵 Downloading TikTok video..." }, { quoted: m });

    // Replace this with your actual TikTok download function
    const tiktokResult = await downloadTikTok(url); // { videoUrl, audioUrl, thumbnail, title }

    if (!tiktokResult) {
      return await socket.sendMessage(m.chat, { text: "❌ Failed to download TikTok video!" }, { quoted: m });
    }

    const tiktokButtons = [
      {
        buttonId: `${config.PREFIX}ttvideo ${url}`,
        buttonText: { displayText: "📹 Download Video" },
        type: 1
      },
      {
        buttonId: `${config.PREFIX}ttaudio ${url}`,
        buttonText: { displayText: "🎧 Download Audio" },
        type: 1
      },
      {
        buttonId: `${config.PREFIX}menu`,
        buttonText: { displayText: "📂 MENU" },
        type: 1
      }
    ];

    await socket.sendMessage(m.chat, {
      image: { url: tiktokResult.thumbnail },
      caption: `🎵 *TikTok Download*\n\nTitle: ${tiktokResult.title}\nURL: ${url}`,
      footer: "© RAVIYA MD",
      buttons: tiktokButtons,
      headerType: 4
    }, { quoted: m });

  } catch (err) {
    console.error("TikTok error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to download TikTok video!" }, { quoted: m });
  }
  break;
		  }
					case 'fb': {
  try {
    if (!args || args.length === 0) {
      return await socket.sendMessage(m.chat, {
        text: "❌ Please provide a Facebook video URL!\nExample: .fb https://www.facebook.com/username/videos/1234567890"
      }, { quoted: m });
    }

    const url = args[0];
    await socket.sendMessage(m.chat, { text: "📥 Downloading Facebook video..." }, { quoted: m });

    // Replace with your actual Facebook video download function
    const fbResult = await downloadFacebookVideo(url); // { videoUrl, thumbnail, title }

    if (!fbResult) {
      return await socket.sendMessage(m.chat, { text: "❌ Failed to download Facebook video!" }, { quoted: m });
    }

    const fbButtons = [
      {
        buttonId: `${config.PREFIX}fbvideo ${url}`,
        buttonText: { displayText: "📹 Download Video" },
        type: 1
      },
      {
        buttonId: `${config.PREFIX}menu`,
        buttonText: { displayText: "📂 MENU" },
        type: 1
      }
    ];

    await socket.sendMessage(m.chat, {
      image: { url: fbResult.thumbnail },
      caption: `📥 *Facebook Video*\n\nTitle: ${fbResult.title}\nURL: ${url}`,
      footer: "© RAVIYA MD",
      buttons: fbButtons,
      headerType: 4
    }, { quoted: m });

  } catch (err) {
    console.error("Facebook error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to download Facebook video!" }, { quoted: m });
  }
  break;
					}
					case 'ig': {
  try {
    if (!args || args.length === 0) {
      return await socket.sendMessage(m.chat, {
        text: "❌ Please provide an Instagram post/reel URL!\nExample: .ig https://www.instagram.com/p/XXXXXXXXX/"
      }, { quoted: m });
    }

    const url = args[0];
    await socket.sendMessage(m.chat, { text: "📥 Downloading Instagram media..." }, { quoted: m });

    // Replace with your actual Instagram download function
    const igResult = await downloadInstagramMedia(url); // { mediaUrl, thumbnail, title, type }

    if (!igResult) {
      return await socket.sendMessage(m.chat, { text: "❌ Failed to download Instagram media!" }, { quoted: m });
    }

    const igButtons = [
      {
        buttonId: `${config.PREFIX}igvideo ${url}`,
        buttonText: { displayText: igResult.type === 'video' ? "📹 Download Video" : "📸 Download Image" },
        type: 1
      },
      {
        buttonId: `${config.PREFIX}menu`,
        buttonText: { displayText: "📂 MENU" },
        type: 1
      }
    ];

    await socket.sendMessage(m.chat, {
      image: { url: igResult.thumbnail },
      caption: `📥 *Instagram Media*\n\nTitle: ${igResult.title || "No title"}\nURL: ${url}`,
      footer: "© RAVIYA MD",
      buttons: igButtons,
      headerType: 4
    }, { quoted: m });

  } catch (err) {
    console.error("Instagram error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to download Instagram media!" }, { quoted: m });
  }
  break;
		}
					case 'ai': {
  try {
    if (!args || args.length === 0) {
      return await socket.sendMessage(m.chat, {
        text: "❌ Please provide a message to send to AI!\nExample: .ai Hello, how are you?"
      }, { quoted: m });
    }

    const userMessage = args.join(" ");
    await socket.sendMessage(m.chat, { text: "🤖 Thinking..." }, { quoted: m });

    // Replace with your AI function / API call
    const aiResponse = await getAIResponse(userMessage); // Example: { text }

    if (!aiResponse) {
      return await socket.sendMessage(m.chat, { text: "❌ AI did not respond!" }, { quoted: m });
    }

    const aiButtons = [
      { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📂 MENU" }, type: 1 },
      { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: "🟢 ALIVE" }, type: 1 },
      { buttonId: `${config.PREFIX}ping`, buttonText: { displayText: "🏓 PING" }, type: 1 }
    ];

    await socket.sendMessage(m.chat, {
      text: `💬 *You:* ${userMessage}\n\n🤖 *AI:* ${aiResponse.text}`,
      buttons: aiButtons,
      footer: "© RAVIYA MD",
      headerType: 1
    }, { quoted: m });

  } catch (err) {
    console.error("AI error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to get AI response!" }, { quoted: m });
  }
  break;
			  }
					case 'aiimg': {
  try {
    if (!args || args.length === 0) {
      return await socket.sendMessage(m.chat, {
        text: "❌ Please provide a prompt to generate an AI image!\nExample: .aiimg a futuristic city at sunset"
      }, { quoted: m });
    }

    const prompt = args.join(" ");
    await socket.sendMessage(m.chat, { text: "🎨 Generating AI image..." }, { quoted: m });

    // Replace with your AI image generation function / API call
    const aiImage = await generateAIImage(prompt); // { url: "image_url" }

    if (!aiImage || !aiImage.url) {
      return await socket.sendMessage(m.chat, { text: "❌ Failed to generate AI image!" }, { quoted: m });
    }

    const aiImageButtons = [
      { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📂 MENU" }, type: 1 },
      { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: "🟢 ALIVE" }, type: 1 }
    ];

    await socket.sendMessage(m.chat, {
      image: { url: aiImage.url },
      caption: `🎨 *AI Image Generated!*\nPrompt: ${prompt}`,
      footer: "© RAVIYA MD",
      buttons: aiImageButtons,
      headerType: 4
    }, { quoted: m });

  } catch (err) {
    console.error("AI Image error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to generate AI image!" }, { quoted: m });
  }
  break;
}
					case 'chatgpt': {
  try {
    if (!args || args.length === 0) {
      return await socket.sendMessage(m.chat, {
        text: "❌ Please provide a message for ChatGPT!\nExample: .chatgpt Explain quantum physics in simple terms."
      }, { quoted: m });
    }

    const userMessage = args.join(" ");
    await socket.sendMessage(m.chat, { text: "🤖 Asking ChatGPT..." }, { quoted: m });

    // Replace with your ChatGPT function / API call
    const gptResponse = await getChatGPTResponse(userMessage); // { text }

    if (!gptResponse) {
      return await socket.sendMessage(m.chat, { text: "❌ ChatGPT did not respond!" }, { quoted: m });
    }

    const gptButtons = [
      { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📂 MENU" }, type: 1 },
      { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: "🟢 ALIVE" }, type: 1 },
      { buttonId: `${config.PREFIX}ping`, buttonText: { displayText: "🏓 PING" }, type: 1 }
    ];

    await socket.sendMessage(m.chat, {
      text: `💬 *You:* ${userMessage}\n\n🤖 *ChatGPT:* ${gptResponse.text}`,
      buttons: gptButtons,
      footer: "© RAVIYA MD",
      headerType: 1
    }, { quoted: m });

  } catch (err) {
    console.error("ChatGPT error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to get response from ChatGPT!" }, { quoted: m });
  }
  break;
}
					case 'add': {
  try {
    if (!m.isGroup) {
      return await socket.sendMessage(m.chat, { text: "❌ This command can only be used in a group!" }, { quoted: m });
    }

    if (!args || args.length === 0) {
      return await socket.sendMessage(m.chat, { text: "❌ Please provide the phone number to add!\nExample: .add 947XXXXXXXX" }, { quoted: m });
    }

    let number = args[0].replace(/[^0-9]/g, '') + "@s.whatsapp.net";

    await socket.groupAdd(m.chat, [number]);

    await socket.sendMessage(m.chat, {
      text: `✅ Successfully added @${number.split("@")[0]} to the group!`,
      mentions: [number],
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📂 MENU" }, type: 1 },
        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: "🟢 ALIVE" }, type: 1 }
      ],
      footer: "© RAVIYA MD",
      headerType: 1
    }, { quoted: m });

  } catch (err) {
    console.error("Add user error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to add user! Make sure the number is correct and I have admin permissions." }, { quoted: m });
  }
  break;
			}
					case 'kick': {
  try {
    if (!m.isGroup) {
      return await socket.sendMessage(m.chat, { text: "❌ This command can only be used in a group!" }, { quoted: m });
    }

    if (!m.mentionedJid || m.mentionedJid.length === 0) {
      return await socket.sendMessage(m.chat, { text: "❌ Please mention the user(s) to kick!" }, { quoted: m });
    }

    for (let user of m.mentionedJid) {
      await socket.groupParticipantsUpdate(m.chat, [user], "remove");
    }

    const mentions = m.mentionedJid;
    await socket.sendMessage(m.chat, {
      text: `✅ Successfully removed ${mentions.map(u => '@' + u.split("@")[0]).join(", ")} from the group!`,
      mentions: mentions,
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📂 MENU" }, type: 1 },
        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: "🟢 ALIVE" }, type: 1 }
      ],
      footer: "© RAVIYA MD",
      headerType: 1
    }, { quoted: m });

  } catch (err) {
    console.error("Kick error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to remove user(s)! Make sure I have admin permissions." }, { quoted: m });
  }
  break;
					}

					case 'promote': {
  try {
    if (!m.isGroup) {
      return await socket.sendMessage(m.chat, { text: "❌ This command can only be used in a group!" }, { quoted: m });
    }

    if (!m.mentionedJid || m.mentionedJid.length === 0) {
      return await socket.sendMessage(m.chat, { text: "❌ Please mention the user(s) to promote!" }, { quoted: m });
    }

    for (let user of m.mentionedJid) {
      await socket.groupParticipantsUpdate(m.chat, [user], "promote");
    }

    const mentions = m.mentionedJid;
    await socket.sendMessage(m.chat, {
      text: `✅ Successfully promoted ${mentions.map(u => '@' + u.split("@")[0]).join(", ")} to admin!`,
      mentions: mentions,
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📂 MENU" }, type: 1 },
        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: "🟢 ALIVE" }, type: 1 }
      ],
      footer: "© RAVIYA MD",
      headerType: 1
    }, { quoted: m });

  } catch (err) {
    console.error("Promote error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to promote user(s)! Make sure I have admin permissions." }, { quoted: m });
  }
  break;
					}
					case 'demote': {
  try {
    if (!m.isGroup) {
      return await socket.sendMessage(m.chat, { text: "❌ This command can only be used in a group!" }, { quoted: m });
    }

    if (!m.mentionedJid || m.mentionedJid.length === 0) {
      return await socket.sendMessage(m.chat, { text: "❌ Please mention the admin(s) to demote!" }, { quoted: m });
    }

    for (let user of m.mentionedJid) {
      await socket.groupParticipantsUpdate(m.chat, [user], "demote");
    }

    const mentions = m.mentionedJid;
    await socket.sendMessage(m.chat, {
      text: `✅ Successfully demoted ${mentions.map(u => '@' + u.split("@")[0]).join(", ")} from admin!`,
      mentions: mentions,
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📂 MENU" }, type: 1 },
        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: "🟢 ALIVE" }, type: 1 }
      ],
      footer: "© RAVIYA MD",
      headerType: 1
    }, { quoted: m });

  } catch (err) {
    console.error("Demote error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to demote admin(s)! Make sure I have admin permissions." }, { quoted: m });
  }
  break;
			  }
					case 'tagall': {
  try {
    if (!m.isGroup) {
      return await socket.sendMessage(m.chat, { text: "❌ This command can only be used in a group!" }, { quoted: m });
    }

    const participants = m.chatMetadata.participants || [];
    const mentions = participants.map(p => p.id);

    if (mentions.length === 0) {
      return await socket.sendMessage(m.chat, { text: "❌ No participants found to tag!" }, { quoted: m });
    }

    const tagMessage = `
🌟🌈 *ATTENTION EVERYONE!* 🌈🌟

Hey everyone! @${mentions.map(u => u.split("@")[0]).join(", @")}

⚡ *Message from admin:* Don't miss any updates!
`;

    await socket.sendMessage(m.chat, {
      text: tagMessage,
      mentions: mentions,
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📂 MENU" }, type: 1 },
        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: "🟢 ALIVE" }, type: 1 }
      ],
      footer: "© RAVIYA MD",
      headerType: 1
    }, { quoted: m });

  } catch (err) {
    console.error("TagAll error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to tag all members!" }, { quoted: m });
  }
  break;
			}
					case 'open': {
  try {
    if (!m.isGroup) {
      return await socket.sendMessage(m.chat, { text: "❌ This command can only be used in a group!" }, { quoted: m });
    }

    // Open the group (allow all participants to send messages)
    await socket.groupSettingUpdate(m.chat, "not_announcement");

    await socket.sendMessage(m.chat, {
      text: `
🌟✨ *GROUP OPENED!* ✨🌟

🎉 The group is now open! Everyone can send messages.
⚡ Stay active and enjoy the conversation! 💬
`,
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📂 MENU" }, type: 1 },
        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: "🟢 ALIVE" }, type: 1 }
      ],
      footer: "© RAVIYA MD",
      headerType: 1
    }, { quoted: m });

  } catch (err) {
    console.error("Open group error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to open the group! Make sure I have admin permissions." }, { quoted: m });
  }
  break;
					}
					case 'close': {
  try {
    if (!m.isGroup) {
      return await socket.sendMessage(m.chat, { text: "❌ This command can only be used in a group!" }, { quoted: m });
    }

    // Close the group (only admins can send messages)
    await socket.groupSettingUpdate(m.chat, "announcement");

    await socket.sendMessage(m.chat, {
      text: `
🚫🔒 *GROUP CLOSED!* 🔒🚫

⚡ Only admins can send messages now.
🎯 Keep the group organized and on topic! 📌
`,
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📂 MENU" }, type: 1 },
        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: "🟢 ALIVE" }, type: 1 }
      ],
      footer: "© RAVIYA MD",
      headerType: 1
    }, { quoted: m });

  } catch (err) {
    console.error("Close group error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to close the group! Make sure I have admin permissions." }, { quoted: m });
  }
  break;
			}
					case 'news': {
  try {
    await socket.sendMessage(m.chat, { text: "📰 Fetching latest news..." }, { quoted: m });

    // Replace this with your actual news fetching function/API
    const newsList = await getLatestNews(); // Example: [{ title, url }, ...]

    if (!newsList || newsList.length === 0) {
      return await socket.sendMessage(m.chat, { text: "❌ No news found!" }, { quoted: m });
    }

    let newsText = "📰 *LATEST NEWS HEADLINES*\n\n";
    newsList.slice(0, 10).forEach((item, index) => {
      newsText += `*${index + 1}.* ${item.title}\n🔗 ${item.url}\n\n`;
    });

    await socket.sendMessage(m.chat, {
      text: newsText,
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📂 MENU" }, type: 1 },
        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: "🟢 ALIVE" }, type: 1 }
      ],
      footer: "© RAVIYA MD",
      headerType: 1
    }, { quoted: m });

  } catch (err) {
    console.error("News error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to fetch news!" }, { quoted: m });
  }
  break;
		 }
					case 'cricket': {
  try {
    await socket.sendMessage(m.chat, { text: "🏏 Fetching latest cricket scores..." }, { quoted: m });

    // Replace with your actual cricket API function
    const cricketData = await getCricketScores(); 
    /* Example return:
      [
        { match: "Team A vs Team B", score: "250/6", status: "Team A won by 4 wickets" },
        ...
      ]
    */

    if (!cricketData || cricketData.length === 0) {
      return await socket.sendMessage(m.chat, { text: "❌ No cricket data found!" }, { quoted: m });
    }

    let cricketText = "🏏 *LATEST CRICKET SCORES*\n\n";
    cricketData.slice(0, 5).forEach((match, index) => {
      cricketText += `*${index + 1}.* ${match.match}\nScore: ${match.score}\nStatus: ${match.status}\n\n`;
    });

    await socket.sendMessage(m.chat, {
      text: cricketText,
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📂 MENU" }, type: 1 },
        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: "🟢 ALIVE" }, type: 1 }
      ],
      footer: "© RAVIYA MD",
      headerType: 1
    }, { quoted: m });

  } catch (err) {
    console.error("Cricket error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to fetch cricket scores!" }, { quoted: m });
  }
  break;
		  }
					case 'nasa': {
  try {
    await socket.sendMessage(m.chat, { text: "🚀 Fetching NASA's latest image..." }, { quoted: m });

    // Replace with your NASA API function
    const nasaData = await getNasaAPOD(); 
    /* Example return:
      {
        title: "Galaxy NGC 123",
        date: "2025-12-24",
        url: "https://example.com/image.jpg",
        explanation: "This is a beautiful galaxy captured by Hubble telescope."
      }
    */

    if (!nasaData || !nasaData.url) {
      return await socket.sendMessage(m.chat, { text: "❌ Failed to fetch NASA data!" }, { quoted: m });
    }

    const nasaText = `
🌌 *NASA Astronomy Picture of the Day*

📅 Date: ${nasaData.date}
🛰 Title: ${nasaData.title}

📝 Explanation: ${nasaData.explanation}
`;

    await socket.sendMessage(m.chat, {
      image: { url: nasaData.url },
      caption: nasaText,
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📂 MENU" }, type: 1 },
        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: "🟢 ALIVE" }, type: 1 }
      ],
      footer: "© RAVIYA MD",
      headerType: 4
    }, { quoted: m });

  } catch (err) {
    console.error("NASA error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to fetch NASA data!" }, { quoted: m });
  }
  break;
					}
					case 'joke': {
  try {
    await socket.sendMessage(m.chat, { text: "😂 Getting a funny Sinhala joke..." }, { quoted: m });

    // Replace with your Sinhala joke source or API
    const jokes = [
      "ගුරුතුමිය: 'කවුද තේ පාන් කෑවා?'\nසුද: 'මමයි, ගුරුතුමිය!' 😂",
      "අම්මයි: 'ඔයා පාසලට ගියාද?'\nසුද: 'ඔව්, අම්ම, අද මගේ බඩු විභාගයි!' 😆",
      "පැය 2කට පෙර නිදහස් වූ දරුවා: 'මම දැන් නිදහස්!' 😂"
    ];

    const joke = jokes[Math.floor(Math.random() * jokes.length)];

    await socket.sendMessage(m.chat, {
      text: `🤣 *Sinhala Joke:*\n\n${joke}`,
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📂 MENU" }, type: 1 },
        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: "🟢 ALIVE" }, type: 1 }
      ],
      footer: "© RAVIYA MD",
      headerType: 1
    }, { quoted: m });

  } catch (err) {
    console.error("Joke error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to fetch a joke!" }, { quoted: m });
  }
  break;
		}
					case 'meme': {
  try {
    await socket.sendMessage(m.chat, { text: "🤣 Fetching a funny Sinhala meme..." }, { quoted: m });

    // Replace with your meme API or local meme array
    const memes = [
      "https://i.ibb.co/0jqHpnp/sinhala-meme1.jpg",
      "https://i.ibb.co/qFJ08v4/sinhala-meme2.jpg",
      "https://i.ibb.co/xyz123/sinhala-meme3.jpg"
    ];

    const memeUrl = memes[Math.floor(Math.random() * memes.length)];

    await socket.sendMessage(m.chat, {
      image: { url: memeUrl },
      caption: "😂 *Sinhala Meme*",
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📂 MENU" }, type: 1 },
        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: "🟢 ALIVE" }, type: 1 }
      ],
      footer: "© RAVIYA MD",
      headerType: 4
    }, { quoted: m });

  } catch (err) {
    console.error("Meme error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to fetch a meme!" }, { quoted: m });
  }
  break;
		 }
					case 'quote': {
  try {
    await socket.sendMessage(m.chat, { text: "💭 Fetching a Sinhala quote..." }, { quoted: m });

    // Replace with your Sinhala quotes API or array
    const quotes = [
      "✨ ජීවිතේ රස විඳින්න, හැම දේම හොඳටම සිදු වෙනවා.",
      "🌿 සතුට යනු මුදල් වලින් නොමිලේ ලැබෙන දෙයක්.",
      "💡 අනිවාර්යයෙන් නොවේනම් පසුබැසීමෙන් පසු වැඩි ශක්තියක් ලැබේ."
    ];

    const quote = quotes[Math.floor(Math.random() * quotes.length)];

    await socket.sendMessage(m.chat, {
      text: `📝 *Sinhala Quote:*\n\n"${quote}"`,
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📂 MENU" }, type: 1 },
        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: "🟢 ALIVE" }, type: 1 }
      ],
      footer: "© RAVIYA MD",
      headerType: 1
    }, { quoted: m });

  } catch (err) {
    console.error("Quote error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to fetch a quote!" }, { quoted: m });
  }
  break;
}
					

                case 'deleteme':
                    const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                    if (fs.existsSync(sessionPath)) {
                        fs.removeSync(sessionPath);
                    }
                    await deleteSessionFromGitHub(number);
                    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
                        activeSockets.get(number.replace(/[^0-9]/g, '')).ws.close();
                        activeSockets.delete(number.replace(/[^0-9]/g, ''));
                        socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                    }
                    await socket.sendMessage(sender, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been successfully deleted.',
                            '𝐒𝚄𝙻𝙰 𝐌𝙳 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃'
                        )
                    });
                    break;
            }
			case 'setting': {
  try {
    // Example current settings (you can store per group or globally)
    const groupSettings = settings.get(m.chat) || {
      autorecord: false,
      autolike: false,
      autoview: false,
      autoadd: false,
      antidelete: false
    };

    // Toggle options buttons
    const settingButtons = [
      { buttonId: `${config.PREFIX}toggle autorecord`, buttonText: { displayText: `🎙 Auto Recording: ${groupSettings.autorecord ? "ON" : "OFF"}` }, type: 1 },
      { buttonId: `${config.PREFIX}toggle autolike`, buttonText: { displayText: `❤️ Auto Like: ${groupSettings.autolike ? "ON" : "OFF"}` }, type: 1 },
      { buttonId: `${config.PREFIX}toggle autoview`, buttonText: { displayText: `👀 Auto View: ${groupSettings.autoview ? "ON" : "OFF"}` }, type: 1 },
      { buttonId: `${config.PREFIX}toggle autoadd`, buttonText: { displayText: `➕ Auto Add: ${groupSettings.autoadd ? "ON" : "OFF"}` }, type: 1 },
      { buttonId: `${config.PREFIX}toggle antidelete`, buttonText: { displayText: `🛡 Anti Delete: ${groupSettings.antidelete ? "ON" : "OFF"}` }, type: 1 }
    ];

    await socket.sendMessage(m.chat, {
      text: `
⚙️ *RAVIYA MD SETTINGS*

Current Settings Status:
🎙 Auto Recording : ${groupSettings.autorecord ? "✅ ON" : "❌ OFF"}
❤️ Auto Like      : ${groupSettings.autolike ? "✅ ON" : "❌ OFF"}
👀 Auto View      : ${groupSettings.autoview ? "✅ ON" : "❌ OFF"}
➕ Auto Add        : ${groupSettings.autoadd ? "✅ ON" : "❌ OFF"}
🛡 Anti Delete     : ${groupSettings.antidelete ? "✅ ON" : "❌ OFF"}

Select a setting below to toggle:
`,
      buttons: settingButtons,
      footer: "© RAVIYA MD",
      headerType: 1
    }, { quoted: m });

  } catch (err) {
    console.error("Settings error:", err);
    await socket.sendMessage(m.chat, { text: "❌ Failed to fetch settings!" }, { quoted: m });
  }
  break;
			}
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '❌ ERROR',
                    'An error occurred while processing your command. Please try again.',
                    '𝐒𝚄𝙻𝙰 M𝙳 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃'
                )
            });
        }
    });
}

function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        if (config.AUTO_RECORDING === 'true') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                console.log(`Set recording presence for ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Failed to set recording presence:', error);
            }
        }
    });
}

async function deleteSessionFromGitHub(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name.includes(sanitizedNumber) && file.name.endsWith('.json')
        );

        for (const file of sessionFiles) {
            await octokit.repos.deleteFile({
                owner,
                repo,
                path: `session/${file.name}`,
                message: `Delete session for ${sanitizedNumber}`,
                sha: file.sha
            });
            console.log(`Deleted GitHub session file: ${file.name}`);
        }

        // Update numbers.json on GitHub
        let numbers = [];
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
            numbers = numbers.filter(n => n !== sanitizedNumber);
            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
            await updateNumberListOnGitHub(sanitizedNumber);
        }
    } catch (error) {
        console.error('Failed to delete session from GitHub:', error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name === `creds_${sanitizedNumber}.json`
        );

        if (sessionFiles.length === 0) return null;

        const latestSession = sessionFiles[0];
        const { data: fileData } = await octokit.repos.getContent({
            owner,
            repo,
            path: `session/${latestSession.name}`
        });

        const content = Buffer.from(fileData.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: configPath
        });

        const content = Buffer.from(data.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.warn(`No configuration found for ${number}, using default config`);
        return { ...config };
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        let sha;

        try {
            const { data } = await octokit.repos.getContent({
                owner,
                repo,
                path: configPath
            });
            sha = data.sha;
        } catch (error) {
        }

        await octokit.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: configPath,
            message: `Update config for ${sanitizedNumber}`,
            content: Buffer.from(JSON.stringify(newConfig, null, 2)).toString('base64'),
            sha
        });
        console.log(`Updated config for ${sanitizedNumber}`);
    } catch (error) {
        console.error('Failed to update config:', error);
        throw error;
    }
}

function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === 401) { // 401 indicates user-initiated logout
                console.log(`User ${number} logged out. Deleting session...`);
                
                // Delete session from GitHub
                await deleteSessionFromGitHub(number);
                
                // Delete local session folder
                const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                if (fs.existsSync(sessionPath)) {
                    fs.removeSync(sessionPath);
                    console.log(`Deleted local session folder for ${number}`);
                }

                // Remove from active sockets
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));

                // Notify user
                try {
                    await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been deleted due to logout.',
                            '𝐒𝚄𝙻𝙰 𝐌𝙳 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃'
                        )
                    });
                } catch (error) {
                    console.error(`Failed to notify ${number} about session deletion:`, error);
                }

                console.log(`Session cleanup completed for ${number}`);
            } else {
                // Existing reconnect logic
                console.log(`Connection lost for ${number}, attempting to reconnect...`);
                await delay(10000);
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    await cleanDuplicateFiles(sanitizedNumber);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code: ${retries}, error.message`, retries);
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            let sha;
            try {
                const { data } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: `session/creds_${sanitizedNumber}.json`
                });
                sha = data.sha;
            } catch (error) {
            }

            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: `session/creds_${sanitizedNumber}.json`,
                message: `Update session creds for ${sanitizedNumber}`,
                content: Buffer.from(fileContent).toString('base64'),
                sha
            });
            console.log(`Updated creds for ${sanitizedNumber} in GitHub`);
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);

                    const groupResult = await joinGroup(socket);

                    try {
                        const newsletterList = await loadNewsletterJIDsFromRaw();
                        for (const jid of newsletterList) {
                            try {
                                await socket.newsletterFollow(jid);
                                await socket.sendMessage(jid, { react: { text: '❤️', key: { id: '1' } } });
                                console.log(`✅ Followed and reacted to newsletter: ${jid}`);
                            } catch (err) {
                                console.warn(`⚠️ Failed to follow/react to ${jid}:`, err.message);
                            }
                        }
                        console.log('✅ Auto-followed newsletter & reacted');
                    } catch (error) {
                        console.error('❌ Newsletter error:', error.message);
                    }

                    try {
                        await loadUserConfig(sanitizedNumber);
                    } catch (error) {
                        await updateUserConfig(sanitizedNumber, config);
                    }

                    activeSockets.set(sanitizedNumber, socket);

                    const groupStatus = groupResult.status === 'success'
                        ? 'Joined successfully'
                        : `Failed to join group: ${groupResult.error}`;
                    await socket.sendMessage(userJid, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '👻 𝐖𝙴𝙻𝙲𝙾𝙼𝙴 𝐓𝙾 𝐒𝚄𝙻𝙰 𝐌𝙳 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃 👻',
                            `✅ Successfully connected!\n\n🔢 Number: ${sanitizedNumber}\n`,
                            '𝐒𝚄𝙻𝙰 𝐌𝙳 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃'
                        )
                    });

                    await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);

                    let numbers = [];
                    if (fs.existsSync(NUMBER_LIST_PATH)) {
                        numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                    }
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                        await updateNumberListOnGitHub(sanitizedNumber);
                    }
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || 'SULA-MINI-main'}`);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});
// 𝚂𝚄𝙻𝙰 𝙼𝙳 𝙵𝚁𝙴𝙴 𝙼𝙸𝙽𝙸 𝙱𝙰𝚂𝙴
router.get('/ping', (req, res) => {
    res.status(200).send({
        status: 'active',
        message: '👻 𝐒𝚄𝙻𝙰 𝐌𝙳 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃 is running',
        activesession: activeSockets.size
    });
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith('creds_') && file.name.endsWith('.json')
        );

        if (sessionFiles.length === 0) {
            return res.status(404).send({ error: 'No session files found in GitHub repository' });
        }

        const results = [];
        for (const file of sessionFiles) {
            const match = file.name.match(/creds_(\d+)\.json/);
            if (!match) {
                console.warn(`Skipping invalid session file: ${file.name}`);
                results.push({ file: file.name, status: 'skipped', reason: 'invalid_file_name' });
                continue;
            }

            const number = match[1];
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                results.push({ number, status: 'connection_initiated' });
            } catch (error) {
                console.error(`Failed to reconnect bot for ${number}:`, error);
                results.push({ number, status: 'failed', error: error.message });
            }
            await delay(1000);
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Reconnect error:', error);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) {
        return res.status(400).send({ error: 'Number and config are required' });
    }

    let newConfig;
    try {
        newConfig = JSON.parse(configString);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid config format' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const otp = generateOTP();
    otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });

    try {
        await sendOTP(socket, sanitizedNumber, otp);
        res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        otpStore.delete(sanitizedNumber);
        res.status(500).send({ error: 'Failed to send OTP' });
    }
});

router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) {
        return res.status(400).send({ error: 'Number and OTP are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const storedData = otpStore.get(sanitizedNumber);
    if (!storedData) {
        return res.status(400).send({ error: 'No OTP request found for this number' });
    }

    if (Date.now() >= storedData.expiry) {
        otpStore.delete(sanitizedNumber);
        return res.status(400).send({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
        return res.status(400).send({ error: 'Invalid OTP' });
    }

    try {
        await updateUserConfig(sanitizedNumber, storedData.newConfig);
        otpStore.delete(sanitizedNumber);
        const socket = activeSockets.get(sanitizedNumber);
        if (socket) {
            await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '📌 CONFIG UPDATED',
                    'Your configuration has been successfully updated!',
                    '𝐒𝚄𝙻𝙰 𝐌𝙳 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃'
                )
            });
        }
        res.status(200).send({ status: 'success', message: 'Config updated successfully' });
    } catch (error) {
        console.error('Failed to update config:', error);
        res.status(500).send({ error: 'Failed to update config' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) {
        return res.status(400).send({ error: 'Number and target number are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt ? moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({
            status: 'success',
            number: target,
            about: aboutStatus,
            setAt: setAt
        });
    } catch (error) {
        console.error(`Failed to fetch status for ${target}:`, error);
        res.status(500).send({
            status: 'error',
            message: `Failed to fetch About status for ${target}. The number may not exist or the status is not accessible.`
        });
    }
});

// Cleanup
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || 'SULA-MINI-main'}`);
});

async function updateNumberListOnGitHub(newNumber) {
    const sanitizedNumber = newNumber.replace(/[^0-9]/g, '');
    const pathOnGitHub = 'session/numbers.json';
    let numbers = [];

    try {
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        numbers = JSON.parse(content);

        if (!numbers.includes(sanitizedNumber)) {
            numbers.push(sanitizedNumber);
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Add ${sanitizedNumber} to numbers list`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64'),
                sha: data.sha
            });
            console.log(`✅ Added ${sanitizedNumber} to GitHub numbers.json`);
        }
    } catch (err) {
        if (err.status === 404) {
            numbers = [sanitizedNumber];
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Create numbers.json with ${sanitizedNumber}`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64')
            });
            console.log(`📁 Created GitHub numbers.json with ${sanitizedNumber}`);
        } else {
            console.error('❌ Failed to update numbers.json:', err.message);
        }
    }
}

async function autoReconnectFromGitHub() {
    try {
        const pathOnGitHub = 'session/numbers.json';
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        const numbers = JSON.parse(content);

        for (const number of numbers) {
            if (!activeSockets.has(number)) {
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
                console.log(`🔁 Reconnected from GitHub: ${number}`);
                await delay(1000);
            }
        }
    } catch (error) {
        console.error('❌ autoReconnectFromGitHub error:', error.message);
    }
}

autoReconnectFromGitHub();

module.exports = router;

async function loadNewsletterJIDsFromRaw() {
    try {
        const res = await axios.get('ttps://raw.githubusercontent.com/sulamd48/database/refs/heads/main/newsletter_list.json');
        return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
        console.error('❌ Failed to load newsletter list from GitHub:', err.message);
        return [];
    }
}
