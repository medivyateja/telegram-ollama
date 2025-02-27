const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Telegram client instance
let client = null;
let monitorActive = false;
let newMessageHandler = null;

// Data directory for storing user messages
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

// Ensure data directory exists
async function ensureDataDirectory() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (error) {
        console.error('Error creating data directory:', error);
    }
}

// Initialize the Telegram client
async function initializeClient() {
    if (client) return client;

    const apiId = parseInt(process.env.TELEGRAM_API_ID);
    const apiHash = process.env.TELEGRAM_API_HASH;
    const sessionString = process.env.TELEGRAM_SESSION;

    if (!apiId || !apiHash || !sessionString) {
        throw new Error('Telegram API credentials or session not configured');
    }

    const stringSession = new StringSession(sessionString);
    client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.connect();
    return client;
}

// Helper function to safely format dates
function formatDate(date) {
    if (!date) return new Date().toISOString();
    
    // If it's already a Date object
    if (date instanceof Date) {
        return date.toISOString();
    }
    
    // If it's a number (Unix timestamp)
    if (typeof date === 'number') {
        return new Date(date * 1000).toISOString();
    }
    
    // If it's an object with seconds property (Telegram format)
    if (date && typeof date === 'object' && date.seconds) {
        return new Date(date.seconds * 1000).toISOString();
    }
    
    // Fallback - try to parse the date
    try {
        return new Date(date).toISOString();
    } catch (e) {
        console.error('Error formatting date:', e);
        return new Date().toISOString();
    }
}

// Save user message to JSON file
async function saveUserMessage(sender, message) {
    await ensureDataDirectory();
    
    // Create a filename based on the user's ID
    const filename = `${sender.id}.json`;
    const filePath = path.join(DATA_DIR, filename);
    
    // Check if file exists and read existing data
    let userData = { 
        profile: {}, 
        messages: [] 
    };
    
    try {
        const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
        if (fileExists) {
            const data = await fs.readFile(filePath, 'utf8');
            userData = JSON.parse(data);
        }
    } catch (error) {
        console.error(`Error reading data file for user ${sender.id}:`, error);
    }
    
    // Update profile information
    userData.profile = {
        id: sender.id,
        firstName: sender.firstName,
        lastName: sender.lastName,
        username: sender.username,
        phone: sender.phone,
        lastUpdated: formatDate(new Date())
    };
    
    // Add the new message
    userData.messages.push({
        id: message.id,
        text: message.text || message.message || '',
        date: formatDate(message.date),
        media: message.media ? true : false,
        mediaType: message.media ? message.media.className : null
    });
    
    // Save the updated data
    await fs.writeFile(filePath, JSON.stringify(userData, null, 2), 'utf8');
    console.log(`Saved message from user ${sender.id} (${sender.firstName || ''} ${sender.lastName || ''})`);
}

// Start monitoring messages
async function startMonitoring() {
    if (monitorActive) return;
    
    try {
        const telegramClient = await initializeClient();
        
        // Register new message event handler
        newMessageHandler = telegramClient.addEventHandler(async (event) => {
            try {
                const message = event.message;
                
                // Skip messages from channels or groups
                if (message.isChannel || message.isGroup) return;
                
                // Get the sender
                const sender = await message.getSender();
                if (!sender || sender.isChannel || sender.isGroup) return;
                
                // Save the message
                await saveUserMessage(sender, message);
            } catch (error) {
                console.error('Error processing message:', error);
            }
        }, new NewMessage({}));
        
        monitorActive = true;
        console.log('Telegram message monitoring started');
    } catch (error) {
        console.error('Error starting message monitor:', error);
        throw error;
    }
}

// Stop monitoring messages
function stopMonitoring() {
    if (!monitorActive || !client || !newMessageHandler) return;
    
    try {
        client.removeEventHandler(newMessageHandler);
        newMessageHandler = null;
        monitorActive = false;
        console.log('Telegram message monitoring stopped');
    } catch (error) {
        console.error('Error stopping message monitoring:', error);
    }
}

// Middleware to ensure user is authenticated
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
}

// Routes for monitor management
router.get('/monitor', ensureAuthenticated, async (req, res) => {
    try {
        // Check if Telegram is connected
        const telegramConnected = process.env.TELEGRAM_SESSION && process.env.TELEGRAM_SESSION !== '';
        
        if (!telegramConnected) {
            req.flash('error', 'Please connect your Telegram account first');
            return res.redirect('/telegram/connect');
        }
        
        // Get list of monitored users
        const users = [];
        try {
            const files = await fs.readdir(DATA_DIR);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const filePath = path.join(DATA_DIR, file);
                    const content = await fs.readFile(filePath, 'utf8');
                    const userData = JSON.parse(content);
                    
                    users.push({
                        id: userData.profile.id,
                        name: `${userData.profile.firstName || ''} ${userData.profile.lastName || ''}`.trim() || 'Unnamed',
                        username: userData.profile.username || 'No username',
                        messageCount: userData.messages.length,
                        lastMessage: userData.messages.length > 0 
                            ? userData.messages[userData.messages.length - 1].date
                            : null
                    });
                }
            }
        } catch (error) {
            console.error('Error reading user data files:', error);
        }
        
        res.render('telegram-monitor', {
            title: 'Telegram Monitor',
            monitorActive,
            users,
            telegramConnected
        });
    } catch (error) {
        console.error('Error rendering monitor page:', error);
        req.flash('error', 'Error accessing monitor: ' + error.message);
        res.redirect('/profile');
    }
});

router.post('/monitor/start', ensureAuthenticated, async (req, res) => {
    try {
        await startMonitoring();
        req.flash('success', 'Telegram message monitoring started');
    } catch (error) {
        console.error('Error starting monitoring:', error);
        req.flash('error', 'Failed to start monitoring: ' + error.message);
    }
    res.redirect('/telegram/monitor');
});

router.post('/monitor/stop', ensureAuthenticated, (req, res) => {
    try {
        stopMonitoring();
        req.flash('success', 'Telegram message monitoring stopped');
    } catch (error) {
        console.error('Error stopping monitoring:', error);
        req.flash('error', 'Failed to stop monitoring: ' + error.message);
    }
    res.redirect('/telegram/monitor');
});

router.get('/monitor/user/:id', ensureAuthenticated, async (req, res) => {
    try {
        const userId = req.params.id;
        const filePath = path.join(DATA_DIR, `${userId}.json`);
        
        try {
            await fs.access(filePath);
        } catch (error) {
            req.flash('error', 'User data not found');
            return res.redirect('/telegram/monitor');
        }
        
        const content = await fs.readFile(filePath, 'utf8');
        const userData = JSON.parse(content);
        
        res.render('telegram-user-messages', {
            title: 'User Messages',
            profile: userData.profile,
            messages: userData.messages.reverse() // Show newest first
        });
    } catch (error) {
        console.error('Error retrieving user messages:', error);
        req.flash('error', 'Error retrieving user messages: ' + error.message);
        res.redirect('/telegram/monitor');
    }
});

process.on('SIGINT', async () => {
    if (monitorActive) {
        console.log('Stopping Telegram monitor before exiting...');
        stopMonitoring();
    }
    
    if (client) {
        console.log('Disconnecting Telegram client...');
        await client.disconnect();
    }
    
    process.exit(0);
});

module.exports = router;