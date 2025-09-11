const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const router = express.Router();
const DB_PATH = path.join(__dirname, '..', 'database.sqlite');

// Admin login (SAME)
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const db = new sqlite3.Database(DB_PATH);

  db.get(`
    SELECT id, username, email, password_hash, is_admin
    FROM users 
    WHERE username = ? AND is_admin = 1
  `, [username], async (err, user) => {
    db.close();

    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    try {
      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = 'admin-token-123'; // TODO: Generate proper JWT token

      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          isAdmin: user.is_admin
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Authentication error' });
    }
  });
});

// Get all daily puzzles (NEW)
router.get('/daily-puzzles', requireAuth, (req, res) => {
  const db = new sqlite3.Database(DB_PATH);

  db.all(`
    SELECT 
      dp.*,
      u.username as created_by_username,
      COUNT(gr.id) as completion_count
    FROM daily_puzzles dp
    LEFT JOIN users u ON dp.created_by = u.id
    LEFT JOIN game_results gr ON dp.id = gr.daily_puzzle_id
    GROUP BY dp.id
    ORDER BY dp.date DESC
  `, (err, dailyPuzzles) => {
    if (err) {
      console.error('Database error in /daily-puzzles:', err);
      db.close();
      return res.status(500).json({ error: 'Database error' });
    }

    // Get clues for each daily puzzle
    const dailyPuzzleIds = dailyPuzzles.map(dp => dp.id);
    
    if (dailyPuzzleIds.length === 0) {
      db.close();
      return res.json([]);
    }

    const placeholders = dailyPuzzleIds.map(() => '?').join(',');
    
    db.all(`
      SELECT daily_puzzle_id, clue_number, clue, answer, linking_word
      FROM puzzle_clues
      WHERE daily_puzzle_id IN (${placeholders})
      ORDER BY daily_puzzle_id, clue_number
    `, dailyPuzzleIds, (err, clues) => {
      db.close();

      if (err) {
        console.error('Database error loading clues:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      // Group clues by daily puzzle
      const cluesByPuzzle = {};
      clues.forEach(clue => {
        if (!cluesByPuzzle[clue.daily_puzzle_id]) {
          cluesByPuzzle[clue.daily_puzzle_id] = [];
        }
        cluesByPuzzle[clue.daily_puzzle_id].push(clue);
      });

      // Combine daily puzzles with their clues
      const result = dailyPuzzles.map(dp => ({
        ...dp,
        clues: cluesByPuzzle[dp.id] || []
      }));

      res.json(result);
    });
  });
});

// Create new daily puzzle (NEW)
router.post('/daily-puzzles', requireAuth, (req, res) => {
  const { date, difficulty = 1, clues } = req.body;

  // Validation
  if (!date || !clues || !Array.isArray(clues) || clues.length !== 5) {
    return res.status(400).json({ error: 'Date and exactly 5 clues are required' });
  }

  // Validate each clue
  for (let i = 0; i < clues.length; i++) {
    const clue = clues[i];
    if (!clue.clue || !clue.answer || !clue.linkingWord) {
      return res.status(400).json({ error: `Clue ${i + 1}: All fields are required` });
    }

    // Validate linking word is in answer
    if (!clue.answer.toUpperCase().includes(clue.linkingWord.toUpperCase())) {
      return res.status(400).json({ 
        error: `Clue ${i + 1}: Linking word must be contained in the answer` 
      });
    }

    // Validate clue doesn't contain answer words
    const answerWords = clue.answer.toUpperCase().split(' ');
    const clueUpper = clue.clue.toUpperCase();
    const forbiddenWords = answerWords.filter(word => 
      word.length > 2 && clueUpper.includes(word)
    );

    if (forbiddenWords.length > 0) {
      return res.status(400).json({ 
        error: `Clue ${i + 1}: Cannot contain these words from the answer: ${forbiddenWords.join(', ')}` 
      });
    }
  }

  const db = new sqlite3.Database(DB_PATH);

  // Start transaction
  db.run('BEGIN TRANSACTION', (err) => {
    if (err) {
      console.error('Transaction start error:', err);
      db.close();
      return res.status(500).json({ error: 'Failed to start transaction' });
    }

    // Create daily puzzle
    db.run(`
      INSERT INTO daily_puzzles (date, difficulty, created_by)
      VALUES (?, ?, ?)
    `, [date, difficulty, req.user.id], function(err) {
      if (err) {
        console.error('Insert daily puzzle error:', err);
        db.run('ROLLBACK');
        db.close();
        if (err.code === 'SQLITE_CONSTRAINT') {
          return res.status(409).json({ error: 'A daily puzzle already exists for this date' });
        }
        return res.status(500).json({ error: 'Failed to create daily puzzle' });
      }

      const dailyPuzzleId = this.lastID;

      // Insert clues
      let insertedClues = 0;
      let hasError = false;

      clues.forEach((clue, index) => {
        if (hasError) return;

        db.run(`
          INSERT INTO puzzle_clues (daily_puzzle_id, clue_number, clue, answer, linking_word)
          VALUES (?, ?, ?, ?, ?)
        `, [
          dailyPuzzleId,
          index + 1,
          clue.clue,
          clue.answer.toUpperCase(),
          clue.linkingWord.toUpperCase()
        ], function(err) {
          if (err && !hasError) {
            console.error(`Insert clue ${index + 1} error:`, err);
            hasError = true;
            db.run('ROLLBACK');
            db.close();
            return res.status(500).json({ error: `Failed to create clue ${index + 1}` });
          }

          insertedClues++;
          if (insertedClues === clues.length && !hasError) {
            // Commit transaction
            db.run('COMMIT', (err) => {
              db.close();
              if (err) {
                console.error('Commit error:', err);
                return res.status(500).json({ error: 'Failed to commit transaction' });
              }

              res.status(201).json({
                success: true,
                dailyPuzzleId: dailyPuzzleId,
                message: 'Daily puzzle created successfully'
              });
            });
          }
        });
      });
    });
  });
});

// Update daily puzzle (NEW)
router.put('/daily-puzzles/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { date, difficulty, clues } = req.body;

  // Validation (same as create)
  if (!date || !clues || !Array.isArray(clues) || clues.length !== 5) {
    return res.status(400).json({ error: 'Date and exactly 5 clues are required' });
  }

  // Validate each clue (same validation as create)
  for (let i = 0; i < clues.length; i++) {
    const clue = clues[i];
    if (!clue.clue || !clue.answer || !clue.linkingWord) {
      return res.status(400).json({ error: `Clue ${i + 1}: All fields are required` });
    }

    if (!clue.answer.toUpperCase().includes(clue.linkingWord.toUpperCase())) {
      return res.status(400).json({ 
        error: `Clue ${i + 1}: Linking word must be contained in the answer` 
      });
    }

    const answerWords = clue.answer.toUpperCase().split(' ');
    const clueUpper = clue.clue.toUpperCase();
    const forbiddenWords = answerWords.filter(word => 
      word.length > 2 && clueUpper.includes(word)
    );

    if (forbiddenWords.length > 0) {
      return res.status(400).json({ 
        error: `Clue ${i + 1}: Cannot contain these words: ${forbiddenWords.join(', ')}` 
      });
    }
  }

  const db = new sqlite3.Database(DB_PATH);

  db.run('BEGIN TRANSACTION', (err) => {
    if (err) {
      console.error('Transaction start error:', err);
      db.close();
      return res.status(500).json({ error: 'Failed to start transaction' });
    }

    // Update daily puzzle
    db.run(`
      UPDATE daily_puzzles 
      SET date = ?, difficulty = ?
      WHERE id = ?
    `, [date, difficulty || 1, id], function(err) {
      if (err) {
        console.error('Update daily puzzle error:', err);
        db.run('ROLLBACK');
        db.close();
        if (err.code === 'SQLITE_CONSTRAINT') {
          return res.status(409).json({ error: 'A daily puzzle already exists for this date' });
        }
        return res.status(500).json({ error: 'Failed to update daily puzzle' });
      }

      if (this.changes === 0) {
        db.run('ROLLBACK');
        db.close();
        return res.status(404).json({ error: 'Daily puzzle not found' });
      }

      // Delete existing clues
      db.run(`DELETE FROM puzzle_clues WHERE daily_puzzle_id = ?`, [id], (err) => {
        if (err) {
          console.error('Delete clues error:', err);
          db.run('ROLLBACK');
          db.close();
          return res.status(500).json({ error: 'Failed to delete old clues' });
        }

        // Insert new clues
        let insertedClues = 0;
        let hasError = false;

        clues.forEach((clue, index) => {
          if (hasError) return;

          db.run(`
            INSERT INTO puzzle_clues (daily_puzzle_id, clue_number, clue, answer, linking_word)
            VALUES (?, ?, ?, ?, ?)
          `, [
            id,
            index + 1,
            clue.clue,
            clue.answer.toUpperCase(),
            clue.linkingWord.toUpperCase()
          ], function(err) {
            if (err && !hasError) {
              console.error(`Update clue ${index + 1} error:`, err);
              hasError = true;
              db.run('ROLLBACK');
              db.close();
              return res.status(500).json({ error: `Failed to update clue ${index + 1}` });
            }

            insertedClues++;
            if (insertedClues === clues.length && !hasError) {
              db.run('COMMIT', (err) => {
                db.close();
                if (err) {
                  console.error('Commit error:', err);
                  return res.status(500).json({ error: 'Failed to commit transaction' });
                }

                res.json({
                  success: true,
                  message: 'Daily puzzle updated successfully'
                });
              });
            }
          });
        });
      });
    });
  });
});

// Delete daily puzzle (NEW)
router.delete('/daily-puzzles/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const db = new sqlite3.Database(DB_PATH);

  // Check if puzzle has game results
  db.get(`
    SELECT COUNT(*) as result_count
    FROM game_results
    WHERE daily_puzzle_id = ?
  `, [id], (err, row) => {
    if (err) {
      console.error('Check game results error:', err);
      db.close();
      return res.status(500).json({ error: 'Database error' });
    }

    if (row.result_count > 0) {
      // Don't delete, just deactivate
      db.run(`
        UPDATE daily_puzzles 
        SET is_active = 0
        WHERE id = ?
      `, [id], function(err) {
        db.close();

        if (err) {
          console.error('Deactivate daily puzzle error:', err);
          return res.status(500).json({ error: 'Failed to deactivate daily puzzle' });
        }

        res.json({
          success: true,
          message: 'Daily puzzle deactivated (has existing game results)'
        });
      });
    } else {
      // Safe to delete (will cascade to clues)
      db.run(`
        DELETE FROM daily_puzzles
        WHERE id = ?
      `, [id], function(err) {
        db.close();

        if (err) {
          console.error('Delete daily puzzle error:', err);
          return res.status(500).json({ error: 'Failed to delete daily puzzle' });
        }

        if (this.changes === 0) {
          return res.status(404).json({ error: 'Daily puzzle not found' });
        }

        res.json({
          success: true,
          message: 'Daily puzzle deleted successfully'
        });
      });
    }
  });
});

// Get admin dashboard stats (UPDATED)
router.get('/dashboard', requireAuth, (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  const today = new Date().toISOString().split('T')[0];

  db.all(`
    SELECT 
      (SELECT COUNT(*) FROM daily_puzzles WHERE is_active = 1) as total_puzzles,
      (SELECT COUNT(*) FROM daily_puzzles WHERE date > ? AND is_active = 1) as future_puzzles,
      (SELECT COUNT(*) FROM daily_puzzles WHERE date = ? AND is_active = 1) as today_puzzle,
      (SELECT COUNT(*) FROM game_results WHERE DATE(completed_at) = ?) as today_plays,
      (SELECT COUNT(*) FROM users WHERE is_admin = 0) as total_users,
      (SELECT AVG(score) FROM game_results WHERE DATE(completed_at) = ?) as today_avg_score,
      (SELECT COUNT(*) FROM game_results WHERE DATE(completed_at) >= DATE('now', '-7 days')) as week_plays
  `, [today, today, today, today], (err, rows) => {
    db.close();

    if (err) {
      console.error('Dashboard stats error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.json(rows[0]);
  });
});

// Bulk import daily puzzles (NEW)
router.post('/daily-puzzles/bulk-import', requireAuth, (req, res) => {
  const { dailyPuzzles } = req.body;

  if (!Array.isArray(dailyPuzzles) || dailyPuzzles.length === 0) {
    return res.status(400).json({ error: 'Daily puzzles array is required' });
  }

  const db = new sqlite3.Database(DB_PATH);
  const results = {
    successful: 0,
    failed: 0,
    errors: []
  };

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    dailyPuzzles.forEach((dailyPuzzle, index) => {
      const { date, difficulty = 1, clues } = dailyPuzzle;

      // Validation
      if (!date || !clues || !Array.isArray(clues) || clues.length !== 5) {
        results.failed++;
        results.errors.push(`Daily puzzle ${index + 1}: Missing date or exactly 5 clues`);
        return;
      }

      // Validate clues
      let clueError = false;
      for (let i = 0; i < clues.length; i++) {
        const clue = clues[i];
        if (!clue.clue || !clue.answer || !clue.linkingWord) {
          results.failed++;
          results.errors.push(`Daily puzzle ${index + 1}, clue ${i + 1}: Missing fields`);
          clueError = true;
          break;
        }

        if (!clue.answer.toUpperCase().includes(clue.linkingWord.toUpperCase())) {
          results.failed++;
          results.errors.push(`Daily puzzle ${index + 1}, clue ${i + 1}: Linking word not in answer`);
          clueError = true;
          break;
        }
      }

      if (clueError) return;

      // Insert daily puzzle
      db.run(`
        INSERT OR IGNORE INTO daily_puzzles (date, difficulty, created_by)
        VALUES (?, ?, ?)
      `, [date, difficulty, req.user.id], function(err) {
        if (err) {
          results.failed++;
          results.errors.push(`Daily puzzle ${index + 1}: ${err.message}`);
        } else if (this.changes > 0) {
          const dailyPuzzleId = this.lastID;
          
          // Insert clues
          clues.forEach((clue, clueIndex) => {
            db.run(`
              INSERT INTO puzzle_clues (daily_puzzle_id, clue_number, clue, answer, linking_word)
              VALUES (?, ?, ?, ?, ?)
            `, [
              dailyPuzzleId,
              clueIndex + 1,
              clue.clue,
              clue.answer.toUpperCase(),
              clue.linkingWord.toUpperCase()
            ]);
          });
          
          results.successful++;
        } else {
          results.failed++;
          results.errors.push(`Daily puzzle ${index + 1}: Date already exists`);
        }
      });
    });

    db.run('COMMIT', (err) => {
      db.close();

      if (err) {
        console.error('Bulk import commit error:', err);
        return res.status(500).json({ error: 'Transaction failed' });
      }

      res.json({
        success: true,
        ...results,
        message: `Import complete: ${results.successful} successful, ${results.failed} failed`
      });
    });
  });
});

// Legacy support - keep old endpoints working temporarily
router.get('/puzzles', requireAuth, (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  
  db.all(`
    SELECT 
      p.*,
      u.username as created_by_username,
      0 as completion_count
    FROM puzzles p
    LEFT JOIN users u ON p.created_by = u.id
    WHERE p.migrated = 0 OR p.migrated IS NULL
    ORDER BY p.date DESC
  `, (err, rows) => {
    db.close();

    if (err) {
      console.error('Legacy puzzles error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.json(rows);
  });
});

// Simple auth middleware
function requireAuth(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  if (token === 'admin-token-123') {
    req.user = { id: 1, isAdmin: true };
    next();
  } else {
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = router;