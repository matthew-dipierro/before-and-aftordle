const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'database.sqlite');

// Create and initialize database
function initDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Error opening database:', err);
        reject(err);
        return;
      }
      console.log('📦 Connected to SQLite database');
    });

    db.serialize(() => {
      // Create daily_puzzles table (NEW - one per day)
      db.run(`
        CREATE TABLE IF NOT EXISTS daily_puzzles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT UNIQUE NOT NULL,
          difficulty INTEGER DEFAULT 1,
          is_active BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by INTEGER,
          plays INTEGER DEFAULT 0,
          avg_score REAL DEFAULT 0,
          avg_time INTEGER DEFAULT 0,
          FOREIGN KEY (created_by) REFERENCES users (id)
        )
      `, (err) => {
        if (err) console.error('Error creating daily_puzzles table:', err);
        else console.log('✅ Daily puzzles table ready');
      });

      // Create puzzle_clues table (NEW - 5 per daily puzzle)
      db.run(`
        CREATE TABLE IF NOT EXISTS puzzle_clues (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          daily_puzzle_id INTEGER NOT NULL,
          clue_number INTEGER NOT NULL,
          clue TEXT NOT NULL,
          answer TEXT NOT NULL,
          linking_word TEXT NOT NULL,
          FOREIGN KEY (daily_puzzle_id) REFERENCES daily_puzzles (id) ON DELETE CASCADE,
          UNIQUE(daily_puzzle_id, clue_number)
        )
      `, (err) => {
        if (err) console.error('Error creating puzzle_clues table:', err);
        else console.log('✅ Puzzle clues table ready');
      });

      // Keep old puzzles table for migration (ensure it exists first)
      db.run(`
        CREATE TABLE IF NOT EXISTS puzzles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT UNIQUE NOT NULL,
          clue TEXT NOT NULL,
          answer TEXT NOT NULL,
          linking_word TEXT NOT NULL,
          difficulty INTEGER DEFAULT 1,
          is_active BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by INTEGER,
          plays INTEGER DEFAULT 0,
          avg_score REAL DEFAULT 0,
          avg_time INTEGER DEFAULT 0
        )
      `, (err) => {
        if (err) console.error('Error creating puzzles table:', err);
        else console.log('✅ Old puzzles table ready (for migration)');
      });

      // Add migrated column if it doesn't exist
      db.run(`
        ALTER TABLE puzzles ADD COLUMN migrated BOOLEAN DEFAULT 0
      `, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.error('Error adding migrated column:', err);
        } else {
          console.log('✅ Migration column ready');
        }
      });

      // Create users table (SAME)
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          is_admin BOOLEAN DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_login DATETIME,
          total_games INTEGER DEFAULT 0,
          current_streak INTEGER DEFAULT 0,
          best_streak INTEGER DEFAULT 0,
          avg_score REAL DEFAULT 0,
          best_score INTEGER DEFAULT 0
        )
      `, (err) => {
        if (err) console.error('Error creating users table:', err);
        else console.log('✅ Users table ready');
      });

      // Update game_results table to reference daily_puzzles
      db.run(`
        CREATE TABLE IF NOT EXISTS game_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          daily_puzzle_id INTEGER,
          score INTEGER NOT NULL,
          completion_time INTEGER NOT NULL,
          hints_used INTEGER DEFAULT 0,
          wrong_answers INTEGER DEFAULT 0,
          hint_breakdown TEXT,
          clue_results TEXT,
          completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id),
          FOREIGN KEY (daily_puzzle_id) REFERENCES daily_puzzles (id)
        )
      `, (err) => {
        if (err) console.error('Error creating game_results table:', err);
        else console.log('✅ Game results table ready');
      });

      // Create admin_sessions table (SAME)
      db.run(`
        CREATE TABLE IF NOT EXISTS admin_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          token TEXT UNIQUE NOT NULL,
          expires_at DATETIME NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id)
        )
      `, (err) => {
        if (err) console.error('Error creating admin_sessions table:', err);
        else console.log('✅ Admin sessions table ready');
      });

      // Insert sample data and migrate existing data (with a small delay to ensure ALTER TABLE completes)
      setTimeout(() => {
        insertSampleDataAndMigrate(db, () => {
          db.close((err) => {
            if (err) {
              console.error('Error closing database:', err);
              reject(err);
            } else {
              console.log('📦 Database connection closed');
              resolve();
            }
          });
        });
      }, 100);
    });
  });
}

async function insertSampleDataAndMigrate(db, callback) {
  try {
    // Create default admin user
    const adminPassword = await bcrypt.hash('admin123', 10);
    
    db.run(`
      INSERT OR IGNORE INTO users (username, email, password_hash, is_admin)
      VALUES (?, ?, ?, ?)
    `, ['admin', 'admin@aftordle.com', adminPassword, 1], (err) => {
      if (err) console.error('Error creating admin user:', err);
      else console.log('👤 Default admin user created (admin/admin123)');
    });

    // Check if we need to migrate existing data (with proper error handling)
    db.get(`SELECT COUNT(*) as count FROM puzzles WHERE migrated = 0 OR migrated IS NULL`, (err, result) => {
      if (err) {
        console.error('Error checking for migration:', err);
        // If there's still an error, try without the migrated column
        db.get(`SELECT COUNT(*) as count FROM puzzles`, (err2, result2) => {
          if (err2) {
            console.error('Error checking puzzles table:', err2);
            createSampleDailyPuzzle(db, callback);
            return;
          }
          
          if (result2.count > 0) {
            console.log(`🔄 Found ${result2.count} puzzles to migrate (without migration tracking)...`);
            migrateExistingPuzzlesWithoutMigrated(db, callback);
          } else {
            createSampleDailyPuzzle(db, callback);
          }
        });
        return;
      }

      if (result.count > 0) {
        console.log(`🔄 Found ${result.count} puzzles to migrate...`);
        migrateExistingPuzzles(db, callback);
      } else {
        // No existing puzzles, create sample daily puzzle
        createSampleDailyPuzzle(db, callback);
      }
    });

  } catch (error) {
    console.error('Error in sample data creation:', error);
    callback();
  }
}

function migrateExistingPuzzles(db, callback) {
  // Get all unmigrated puzzles grouped by date
  db.all(`
    SELECT date, difficulty, created_by, MIN(id) as first_id, 
           GROUP_CONCAT(id) as puzzle_ids,
           GROUP_CONCAT(clue || '|||' || answer || '|||' || linking_word, ':::') as clue_data
    FROM puzzles 
    WHERE migrated = 0 OR migrated IS NULL
    GROUP BY date 
    ORDER BY date
  `, (err, dateGroups) => {
    if (err) {
      console.error('Error getting puzzles for migration:', err);
      callback();
      return;
    }

    if (dateGroups.length === 0) {
      console.log('📝 No puzzles to migrate');
      createSampleDailyPuzzle(db, callback);
      return;
    }

    performMigration(db, dateGroups, callback);
  });
}

function migrateExistingPuzzlesWithoutMigrated(db, callback) {
  // Get all puzzles grouped by date (without checking migrated column)
  db.all(`
    SELECT date, difficulty, created_by, MIN(id) as first_id, 
           GROUP_CONCAT(id) as puzzle_ids,
           GROUP_CONCAT(clue || '|||' || answer || '|||' || linking_word, ':::') as clue_data
    FROM puzzles 
    GROUP BY date 
    ORDER BY date
  `, (err, dateGroups) => {
    if (err) {
      console.error('Error getting puzzles for migration:', err);
      callback();
      return;
    }

    if (dateGroups.length === 0) {
      console.log('📝 No puzzles to migrate');
      createSampleDailyPuzzle(db, callback);
      return;
    }

    // Check if daily puzzles already exist to avoid duplicates
    db.get(`SELECT COUNT(*) as count FROM daily_puzzles`, (err, result) => {
      if (err) {
        console.error('Error checking daily puzzles:', err);
        callback();
        return;
      }

      if (result.count > 0) {
        console.log('📝 Daily puzzles already exist, skipping migration');
        callback();
        return;
      }

      performMigration(db, dateGroups, callback);
    });
  });
}

function performMigration(db, dateGroups, callback) {
  let migratedCount = 0;
  const totalGroups = dateGroups.length;

  dateGroups.forEach((group, index) => {
    // Create daily puzzle
    db.run(`
      INSERT OR IGNORE INTO daily_puzzles (date, difficulty, created_by, plays, avg_score, avg_time)
      VALUES (?, ?, ?, 0, 0, 0)
    `, [group.date, group.difficulty || 1, group.created_by || 1], function(err) {
      if (err) {
        console.error(`Error creating daily puzzle for ${group.date}:`, err);
        migratedCount++;
        if (migratedCount === totalGroups) callback();
        return;
      }

      const dailyPuzzleId = this.lastID;
      const clueDataArray = group.clue_data.split(':::');
      
      // Create up to 5 clues for this daily puzzle
      clueDataArray.slice(0, 5).forEach((clueData, clueIndex) => {
        const [clue, answer, linkingWord] = clueData.split('|||');
        
        db.run(`
          INSERT INTO puzzle_clues (daily_puzzle_id, clue_number, clue, answer, linking_word)
          VALUES (?, ?, ?, ?, ?)
        `, [dailyPuzzleId, clueIndex + 1, clue, answer, linkingWord], (err) => {
          if (err) {
            console.error(`Error migrating clue ${clueIndex + 1} for ${group.date}:`, err);
          }
        });
      });

      // Mark original puzzles as migrated (if column exists)
      const puzzleIds = group.puzzle_ids.split(',');
      puzzleIds.forEach(puzzleId => {
        db.run(`UPDATE puzzles SET migrated = 1 WHERE id = ?`, [puzzleId], (err) => {
          // Ignore errors if migrated column doesn't exist
        });
      });

      console.log(`🧩 Migrated ${Math.min(clueDataArray.length, 5)} clues for ${group.date}`);
      
      migratedCount++;
      if (migratedCount === totalGroups) {
        console.log(`✅ Migration complete! Converted ${totalGroups} daily puzzles`);
        callback();
      }
    });
  });
}

function createSampleDailyPuzzle(db, callback) {
  const today = new Date().toISOString().split('T')[0];
  
  // Check if today's puzzle already exists
  db.get(`SELECT COUNT(*) as count FROM daily_puzzles WHERE date = ?`, [today], (err, result) => {
    if (err) {
      console.error('Error checking for existing daily puzzle:', err);
      callback();
      return;
    }

    if (result.count > 0) {
      console.log('📝 Today\'s sample daily puzzle already exists');
      callback();
      return;
    }

    // Create sample daily puzzle
    db.run(`
      INSERT INTO daily_puzzles (date, difficulty, created_by)
      VALUES (?, ?, ?)
    `, [today, 1, 1], function(err) {
      if (err) {
        console.error('Error creating sample daily puzzle:', err);
        callback();
        return;
      }

      const dailyPuzzleId = this.lastID;
      
      // Sample clues for today
      const sampleClues = [
        {
          clue: "Device for pointing and clicking + Device to catch rodents",
          answer: "COMPUTER MOUSE TRAP",
          linking_word: "MOUSE"
        },
        {
          clue: "Furniture for beverages + Book navigation aid",
          answer: "COFFEE TABLE OF CONTENTS",
          linking_word: "TABLE"
        },
        {
          clue: "Sequential art series + Piece of breakfast meat",
          answer: "COMIC STRIP OF BACON",
          linking_word: "STRIP"
        },
        {
          clue: "Former Secretary of State + Breakfast cereal treats",
          answer: "CONDOLEEZZA RICE KRISPIES TREATS",
          linking_word: "RICE"
        },
        {
          clue: "Feeling extremely pleased + Legendary rock band",
          answer: "TICKLED PINK FLOYD",
          linking_word: "PINK"
        }
      ];

      let insertedClues = 0;
      sampleClues.forEach((clue, index) => {
        db.run(`
          INSERT INTO puzzle_clues (daily_puzzle_id, clue_number, clue, answer, linking_word)
          VALUES (?, ?, ?, ?, ?)
        `, [dailyPuzzleId, index + 1, clue.clue, clue.answer, clue.linking_word], (err) => {
          if (err) {
            console.error(`Error inserting sample clue ${index + 1}:`, err);
          } else {
            console.log(`🧩 Sample clue ${index + 1} added for ${today}`);
          }
          
          insertedClues++;
          if (insertedClues === sampleClues.length) {
            callback();
          }
        });
      });
    });
  });
}

function getDateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

// Run initialization if called directly
if (require.main === module) {
  initDatabase()
    .then(() => {
      console.log('🎉 Database initialization complete!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Database initialization failed:', err);
      process.exit(1);
    });
}

module.exports = { initDatabase };