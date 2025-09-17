// scripts/add-clue-library.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'database.sqlite');

function addClueLibrary() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Error opening database:', err);
        reject(err);
        return;
      }
      console.log('🔗 Connected to SQLite database for clue library migration');
    });

    db.serialize(() => {
      // Create clue library table
      db.run(`
        CREATE TABLE IF NOT EXISTS clue_library (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          clue TEXT NOT NULL,
          answer TEXT NOT NULL,
          linking_word TEXT NOT NULL,
          difficulty INTEGER DEFAULT 2 CHECK(difficulty IN (1, 2, 3)),
          category TEXT,
          tags TEXT, -- JSON array of tags
          used BOOLEAN DEFAULT 0,
          last_used_date TEXT,
          is_active BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by INTEGER,
          FOREIGN KEY (created_by) REFERENCES users (id)
        )
      `, (err) => {
        if (err) {
          console.error('Error creating clue_library table:', err);
          reject(err);
          return;
        }
        console.log('✅ Clue library table created');
      });

      // Add source_clue_id to puzzle_clues table (to track which library clue was used)
      db.run(`
        ALTER TABLE puzzle_clues 
        ADD COLUMN source_clue_id INTEGER REFERENCES clue_library(id)
      `, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.error('Error adding source_clue_id column:', err);
        } else {
          console.log('✅ Added source_clue_id column to puzzle_clues');
        }
      });

      // Create indexes for better performance
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_clue_library_used 
        ON clue_library(used, is_active)
      `, (err) => {
        if (err) console.error('Error creating index:', err);
        else console.log('✅ Created performance index');
      });

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_clue_library_difficulty 
        ON clue_library(difficulty, used, is_active)
      `, (err) => {
        if (err) console.error('Error creating difficulty index:', err);
        else console.log('✅ Created difficulty index');
      });

      // Add 5 test clues to verify everything works
      console.log('📝 Adding test clues...');
      
      const testClues = [
        {
          clue: "Hawaiian '24k' pop star + Campy sci-fi invasion movie",
          answer: "BRUNO MARS ATTACKS",
          linking_word: "MARS",
          difficulty: 2,
          category: "Entertainment"
        },
        {
          clue: "Alien's famous phone request + Orange-aproned hardware store",
          answer: "E.T. PHONE HOME DEPOT",
          linking_word: "HOME",
          difficulty: 2,
          category: "Movies"
        },
        {
          clue: "Plastic toy with removable parts + Squad's top spirit leader",
          answer: "MR. POTATO HEAD CHEERLEADER",
          linking_word: "HEAD",
          difficulty: 2,
          category: "Entertainment"
        },
        {
          clue: "Australian 'Grease' singer + 35th U.S. President",
          answer: "OLIVIA NEWTON-JOHN F. KENNEDY",
          linking_word: "JOHN",
          difficulty: 3,
          category: "People"
        },
        {
          clue: "Total victory achievement + Clean house thoroughly",
          answer: "CLEAN SWEEP",
          linking_word: "CLEAN",
          difficulty: 1,
          category: "General"
        }
      ];

      let inserted = 0;
      testClues.forEach((clue, index) => {
        db.run(`
          INSERT INTO clue_library (clue, answer, linking_word, difficulty, category, used)
          VALUES (?, ?, ?, ?, ?, 0)
        `, [clue.clue, clue.answer, clue.linking_word, clue.difficulty, clue.category], (err) => {
          if (err) {
            console.error(`Error inserting test clue ${index + 1}:`, err);
          } else {
            inserted++;
          }
          
          if (index === testClues.length - 1) {
            console.log(`📚 Added ${inserted} test clues to library`);
            
            db.close((err) => {
              if (err) {
                console.error('Error closing database:', err);
                reject(err);
              } else {
                console.log('🎉 Clue library setup complete!');
                console.log('');
                console.log('✅ What was created:');
                console.log('   - clue_library table with proper indexes');
                console.log('   - source_clue_id column in puzzle_clues');
                console.log(`   - ${inserted} test clues ready to use`);
                console.log('');
                console.log('🔍 Verify installation:');
                console.log('   - Your existing puzzles still work normally');
                console.log('   - New clue_library table has test data');
                console.log('');
                console.log('📋 Next steps:');
                console.log('   1. Test that your current game still works');
                console.log('   2. Add the clue library interface');
                console.log('   3. Import more Wheel of Fortune phrases');
                resolve();
              }
            });
          }
        });
      });
    });
  });
}

// Run migration if called directly
if (require.main === module) {
  addClueLibrary()
    .then(() => {
      console.log('Migration completed successfully!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { addClueLibrary };
