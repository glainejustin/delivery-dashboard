const express = require('express');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// --- MongoDB Configuration ---
// Fallback to standard connection string if SRV timeouts continue
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://admin:AforApple900@ac-bl88nlv-shard-00-00.k84lxxl.mongodb.net:27017,ac-bl88nlv-shard-00-01.k84lxxl.mongodb.net:27017,ac-bl88nlv-shard-00-02.k84lxxl.mongodb.net:27017/?ssl=true&authSource=admin&retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('Connected to MongoDB Atlas');
        initialSync();
    })
    .catch(err => console.error('MongoDB connection error:', err));

const deliverySchema = new mongoose.Schema({
    id: { type: String, unique: true },
    name: String,
    status: String,
    progress: Number,
    direction: String,
    totalTripTime: Number,
    isAuto: Boolean,
    vanReg: String,
    order: Number
});

const Delivery = mongoose.model('Delivery', deliverySchema);

let deliveries = [];

// --- Persistence Logic ---

async function initialSync() {
    try {
        const count = await Delivery.countDocuments();
        if (count === 0) {
            console.log('Database empty. Migrating from data.json...');
            const DATA_FILE = path.join(__dirname, 'data.json');
            if (fs.existsSync(DATA_FILE)) {
                const fileData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
                const docs = fileData.map((d, index) => ({ ...d, order: index }));
                await Delivery.insertMany(docs);
                console.log(`Migrated ${docs.length} stores to MongoDB.`);
            }
        }
        
        // Load state from DB
        const dbDeliveries = await Delivery.find().sort({ order: 1 });
        deliveries = dbDeliveries.map(d => d.toObject());
        console.log('Dashboard state loaded from MongoDB.');
        
        // Broadcast initial state once loaded
        io.emit('fullSync', deliveries);
    } catch (err) {
        console.error('Initial sync error:', err);
    }
}

async function saveData() {
    try {
        const ops = deliveries.map((d, index) => ({
            updateOne: {
                filter: { id: d.id },
                update: { ...d, order: index },
                upsert: true
            }
        }));
        await Delivery.bulkWrite(ops);
    } catch (err) {
        console.error('Error saving to MongoDB:', err);
    }
}

app.use(express.static(__dirname));

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    
    // Inform the new client of the overall structural state
    socket.emit('fullSync', deliveries);
    
    socket.on('setDirection', ({id, dir}) => {
        const index = deliveries.findIndex(d => d.id === id);
        if (index === -1) return;
        const d = deliveries[index];
        if (d.status === 'canceled') return;
        
        if (d.isAuto && d.direction === dir) {
            d.isAuto = false;
            io.emit('stateUpdate', deliveries);
        } else {
            d.isAuto = true;
            d.direction = dir;
            
            // Move to top
            deliveries.splice(index, 1);
            deliveries.unshift(d);
            
            io.emit('fullSync', deliveries);
        }
        saveData();
    });
    
    socket.on('manualDrag', ({id, newValue}) => {
        const d = deliveries.find(d => d.id === id);
        if(!d) return;
        
        const nextValue = parseFloat(newValue);
        if (nextValue > d.progress) d.direction = 'out';
        else if (nextValue < d.progress) d.direction = 'in';
        
        if (nextValue <= 0) d.direction = 'out';
        if (nextValue >= 100) d.direction = 'in';
        
        d.progress = nextValue;
        d.isAuto = false; 
        
        io.emit('stateUpdate', deliveries);
        saveData();
    });
    
    socket.on('saveStore', async (data) => {
        if(data.id) {
            const d = deliveries.find(d => d.id === data.id);
            if(d) {
                d.name = data.name;
                d.totalTripTime = data.time;
                d.vanReg = data.vanReg;
            }
        } else {
            const newId = data.name.toLowerCase().replace(/\s+/g, '-');
            deliveries.push({
                id: newId, name: data.name, status: 'idle', progress: 0, direction: 'out',
                totalTripTime: data.time, isAuto: false, vanReg: data.vanReg
            });
        }
        io.emit('fullSync', deliveries);
        saveData();
    });
    
    socket.on('deleteStore', async (id) => {
        deliveries = deliveries.filter(d => d.id !== id);
        await Delivery.deleteOne({ id: id }); // Also delete from DB immediately
        io.emit('fullSync', deliveries);
        saveData();
    });

    socket.on('reorderStores', (newOrderIds) => {
        const reordered = [];
        newOrderIds.forEach(id => {
            const d = deliveries.find(x => x.id === id);
            if(d) reordered.push(d);
        });
        if(reordered.length === deliveries.length) {
            deliveries = reordered;
            io.emit('fullSync', deliveries);
            saveData();
        }
    });
});

// Master Server Tick
setInterval(() => {
    let stateChanged = false;
    deliveries.forEach(d => {
        if (d.isAuto) {
            const percentPerSecond = 100 / (d.totalTripTime * 60);
            let nextValue = d.progress + (d.direction === 'out' ? percentPerSecond : -percentPerSecond);
            
            if (nextValue >= 100) {
                nextValue = 100;
                d.isAuto = false;
            } else if (nextValue <= 0) {
                nextValue = 0;
                d.isAuto = false;
            }
            d.progress = nextValue;
            stateChanged = true;
        }
    });
    
    if (stateChanged) {
        io.emit('stateUpdate', deliveries);
        saveData();
    }
}, 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Multiplayer delivery dashboard running on port ${PORT}`);
});
