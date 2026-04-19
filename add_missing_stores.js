const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb://admin:AforApple900@ac-bl88nlv-shard-00-00.k84lxxl.mongodb.net:27017,ac-bl88nlv-shard-00-01.k84lxxl.mongodb.net:27017,ac-bl88nlv-shard-00-02.k84lxxl.mongodb.net:27017/?ssl=true&authSource=admin&retryWrites=true&w=majority';

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

const missingStores = [
    "BIG SMOKE", "BENITOS", "NOLITO", "CHOPSTIX", "BURGER KING", 
    "STARBUCKS", "KURT GEIGER", "ACCESORIZE", "BLACK SHEEP", "WASABI", 
    "SMITHFIELDS", "HAWKERS", "SANFORDS", "PRET", "BOOTS", 
    "KRISPY KREME", "JD SPORTS"
];

async function addMissing() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');
        
        const count = await Delivery.countDocuments();
        let currentOrder = count;

        for (const name of missingStores) {
            const id = name.toLowerCase().replace(/\s+/g, '-');
            const exists = await Delivery.findOne({ id: id });
            if (!exists) {
                await Delivery.create({
                    id: id,
                    name: name,
                    status: 'idle',
                    progress: 0,
                    direction: 'out',
                    totalTripTime: 30,
                    isAuto: false,
                    vanReg: '',
                    order: currentOrder++
                });
                console.log(`Added: ${name}`);
            } else {
                console.log(`Skipped (already exists): ${name}`);
            }
        }
        
        console.log('Finished adding missing stores.');
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

addMissing();
