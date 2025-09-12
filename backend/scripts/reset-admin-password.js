const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'database.sqlite');
const newPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';

async function resetAdminPassword() {
    console.log('🔄 Updating admin password...');
    
    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const db = new sqlite3.Database(DB_PATH);
        
        db.run(`UPDATE users SET password_hash = ? WHERE username = 'admin'`, 
               [hashedPassword], 
               function(err) {
                   if (err) {
                       console.error('❌ Error updating password:', err);
                   } else {
                       console.log('✅ Admin password updated successfully');
                       console.log('🔑 New password from environment variable');
                   }
                   db.close();
               });
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

resetAdminPassword();
