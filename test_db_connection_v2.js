const mongoose = require('mongoose');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const uris = [
    'mongodb+srv://admin:W%2ACrjbBjY2pCa1%24@cluster0.k84lxxl.mongodb.net/?appName=Cluster0',
    'mongodb+srv://admin:W*CrjbBjY2pCa1$@cluster0.k84lxxl.mongodb.net/?appName=Cluster0'
];

async function test() {
    for (const uri of uris) {
        console.log(`Testing URI: ${uri.replace(/:([^@]+)@/, ':****@')}`);
        try {
            await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
            console.log('SUCCESS: Connected!');
            process.exit(0);
        } catch (err) {
            console.error('FAILURE:', err.message);
            await mongoose.disconnect();
        }
    }
    process.exit(1);
}

test();
