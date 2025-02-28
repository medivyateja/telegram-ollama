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

// Track ignored user IDs (users whose monitoring is paused)
let ignoredUsers = new Set();

// Get the user's own phone number from environment variables
const OWN_PHONE_NUMBER = process.env.TELEGRAM_PHONE;

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

// Check if a user is the account owner
function isOwnAccount(sender) {
    if (!sender) return false;
    
    // Check by phone number if available
    if (sender.phone && OWN_PHONE_NUMBER) {
        // Normalize phone numbers by removing anything that's not a digit
        const normalizedSenderPhone = sender.phone.replace(/\D/g, '');
        const normalizedOwnPhone = OWN_PHONE_NUMBER.replace(/\D/g, '');
        
        if (normalizedSenderPhone === normalizedOwnPhone) {
            return true;
        }
    }
    
    return false;
}

// Save user message to JSON file
async function saveUserMessage(sender, message) {
    await ensureDataDirectory();
    
    // Skip messages from your own account
    if (isOwnAccount(sender)) {
        console.log('Skipping message from own account');
        return;
    }
    
    // Skip messages from ignored users
    if (ignoredUsers.has(sender.id.toString())) {
        console.log(`Skipping message from ignored user: ${sender.id}`);
        return;
    }
    
    // Create a filename based on the user's ID
    const filename = `${sender.id}.json`;
    const filePath = path.join(DATA_DIR, filename);
    
    // Check if file exists and read existing data
    let userData = { 
        profile: {}, 
        messages: [],
        monitoringActive: true
    };
    
    try {
        const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
        if (fileExists) {
            const data = await fs.readFile(filePath, 'utf8');
            userData = JSON.parse(data);
            
            // If the user has monitoring disabled in their profile, skip
            if (userData.monitoringActive === false) {
                console.log(`Skipping message from user with disabled monitoring: ${sender.id}`);
                return;
            }
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
    
    // Make sure monitoringActive property exists
    if (userData.monitoringActive === undefined) {
        userData.monitoringActive = true;
    }
    
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

// Load ignored users from data files
async function loadIgnoredUsers() {
    ignoredUsers.clear();
    
    try {
        const files = await fs.readdir(DATA_DIR);
        for (const file of files) {
            if (file.endsWith('.json')) {
                const filePath = path.join(DATA_DIR, file);
                const content = await fs.readFile(filePath, 'utf8');
                const userData = JSON.parse(content);
                
                if (userData.monitoringActive === false) {
                    ignoredUsers.add(userData.profile.id.toString());
                }
            }
        }
        console.log(`Loaded ${ignoredUsers.size} ignored users`);
    } catch (error) {
        console.error('Error loading ignored users:', error);
    }
}

// Start monitoring messages
async function startMonitoring() {
    if (monitorActive) return;
    
    try {
        const telegramClient = await initializeClient();
        
        // Load ignored users
        await loadIgnoredUsers();
        
        // Get own user information to help with filtering
        const me = await telegramClient.getMe();
        console.log('Logged in as:', me.firstName, me.lastName || '', `(${me.phone || 'No phone'})`);
        
        // Register new message event handler
        newMessageHandler = telegramClient.addEventHandler(async (event) => {
            try {
                const message = event.message;
                
                // Skip messages from channels or groups
                if (message.isChannel || message.isGroup) return;
                
                // Get the sender
                const sender = await message.getSender();
                if (!sender || sender.isChannel || sender.isGroup) return;
                
                // Skip messages from your own account
                if (isOwnAccount(sender) || (me && sender.id === me.id)) {
                    console.log('Skipping message from own account');
                    return;
                }
                
                // Log basic info about the message
                console.log(`Received message from ${sender.firstName || ''} ${sender.lastName || ''} (ID: ${sender.id})`);
                
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

// Toggle monitoring for a specific user
async function toggleUserMonitoring(userId, enable) {
    try {
        const filePath = path.join(DATA_DIR, `${userId}.json`);
        await fs.access(filePath); // Check if file exists
        
        const content = await fs.readFile(filePath, 'utf8');
        const userData = JSON.parse(content);
        
        // Update monitoring status
        userData.monitoringActive = enable;
        
        // Save updated data
        await fs.writeFile(filePath, JSON.stringify(userData, null, 2), 'utf8');
        
        // Update ignored users set
        if (enable) {
            ignoredUsers.delete(userId.toString());
        } else {
            ignoredUsers.add(userId.toString());
        }
        
        return true;
    } catch (error) {
        console.error(`Error toggling monitoring for user ${userId}:`, error);
        return false;
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
                    
                    // Ensure monitoringActive property exists
                    if (userData.monitoringActive === undefined) {
                        userData.monitoringActive = true;
                    }
                    
                    users.push({
                        id: userData.profile.id,
                        name: `${userData.profile.firstName || ''} ${userData.profile.lastName || ''}`.trim() || 'Unnamed',
                        username: userData.profile.username || 'No username',
                        messageCount: userData.messages.length,
                        monitoringActive: userData.monitoringActive,
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

// Toggle monitoring for a specific user
router.post('/monitor/user/:id/toggle', ensureAuthenticated, async (req, res) => {
    try {
        const userId = req.params.id;
        const { action } = req.body;
        const enable = action === 'start';
        
        const success = await toggleUserMonitoring(userId, enable);
        
        if (success) {
            req.flash('success', `Monitoring ${enable ? 'started' : 'stopped'} for this user`);
        } else {
            req.flash('error', `Failed to ${enable ? 'start' : 'stop'} monitoring for this user`);
        }
        
        // If global monitoring is active, reload the ignored users list
        if (monitorActive) {
            await loadIgnoredUsers();
        }
        
        // Redirect back to the previous page (either user detail or monitor list)
        const referer = req.headers.referer;
        if (referer && referer.includes('/monitor/user/')) {
            res.redirect(`/telegram/monitor/user/${userId}`);
        } else {
            res.redirect('/telegram/monitor');
        }
    } catch (error) {
        console.error('Error toggling user monitoring:', error);
        req.flash('error', 'Error toggling user monitoring: ' + error.message);
        res.redirect('/telegram/monitor');
    }
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
        
        // Ensure monitoringActive property exists
        if (userData.monitoringActive === undefined) {
            userData.monitoringActive = true;
        }
        
        res.render('telegram-user-messages', {
            title: 'User Messages',
            profile: userData.profile,
            monitoringActive: userData.monitoringActive,
            messages: userData.messages.reverse(), // Show newest first
            globalMonitorActive: monitorActive
        });
    } catch (error) {
        console.error('Error retrieving user messages:', error);
        req.flash('error', 'Error retrieving user messages: ' + error.message);
        res.redirect('/telegram/monitor');
    }
});

// Route to delete user data
router.post('/monitor/user/:id/delete', ensureAuthenticated, async (req, res) => {
    try {
        const userId = req.params.id;
        const filePath = path.join(DATA_DIR, `${userId}.json`);
        
        try {
            await fs.access(filePath);
            await fs.unlink(filePath);
            
            // Remove from ignored users if present
            ignoredUsers.delete(userId.toString());
            
            req.flash('success', 'User data deleted successfully');
        } catch (error) {
            req.flash('error', 'Could not delete user data: ' + error.message);
        }
        
        res.redirect('/telegram/monitor');
    } catch (error) {
        console.error('Error deleting user data:', error);
        req.flash('error', 'Error deleting user data: ' + error.message);
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