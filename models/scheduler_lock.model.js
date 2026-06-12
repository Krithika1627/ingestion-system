const mongoose = require('mongoose');

const schedulerLockSchema =
    new mongoose.Schema({
        storeId: {
            type: String,
            unique: true
        },

        expiresAt: {
            type: Date,
            required: true
        }
    });

schedulerLockSchema.index(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
);

module.exports = mongoose.model(
    'SchedulerLock',
    schedulerLockSchema
);