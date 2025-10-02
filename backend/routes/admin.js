const express = require('express');
const pool = require('../db-connection');
const bcrypt = require('bcryptjs');

const router = express.Router();

function getTodayEastern() {
  const now = new Date();
  const easternDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const year = easternDate.getFullYear();
  const month = String(easternDate.getMonth() + 1).padStart(2, '0');
  const day = String(easternDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Admin login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const result = await pool.query(`
      SELECT id, username, email, password_hash, is_admin
      FROM users 
      WHERE username = $1 AND is_admin = true
    `, [username]);

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

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
    console.error('Database error in login:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
});

// Get all daily puzzles
router.get('/daily-puzzles', requireAuth, async (req, res) => {
  try {
    const dailyPuzzlesResult = await pool.query(`
      SELECT 
        dp.*,
        u.username as created_by_username,
        COUNT(gr.id) as completion_count
      FROM daily_puzzles dp
      LEFT JOIN users u ON dp.created_by = u.id
      LEFT JOIN game_results gr ON dp.id = gr.daily_puzzle_id
      GROUP BY dp.id, u.username
      ORDER BY dp.date DESC
    `);

    const dailyPuzzles = dailyPuzzlesResult.rows;

    if (dailyPuzzles.length === 0) {
      return res.json([]);
    }

    const dailyPuzzleIds = dailyPuzzles.map(dp => dp.id);
    
    const cluesResult = await pool.query(`
      SELECT daily_puzzle_id, clue_number, clue, answer, linking_word
      FROM puzzle_clues
      WHERE daily_puzzle_id = ANY($1)
      ORDER BY daily_puzzle_id, clue_number
    `, [dailyPuzzleIds]);

    const clues = cluesResult.rows;

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
  } catch (error) {
    console.error('Database error in /daily-puzzles:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Create new daily puzzle
router.post('/daily-puzzles', requireAuth, async (req, res) => {
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

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Create daily puzzle
    const dailyPuzzleResult = await client.query(`
      INSERT INTO daily_puzzles (date, difficulty, created_by)
      VALUES ($1, $2, $3)
      RETURNING id
    `, [date, difficulty, req.user.id]);

    const dailyPuzzleId = dailyPuzzleResult.rows[0].id;

    // Insert clues
    for (let i = 0; i < clues.length; i++) {
      const clue = clues[i];
      await client.query(`
        INSERT INTO puzzle_clues (daily_puzzle_id, clue_number, clue, answer, linking_word)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        dailyPuzzleId,
        i + 1,
        clue.clue,
        clue.answer.toUpperCase(),
        clue.linkingWord.toUpperCase()
      ]);
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      dailyPuzzleId: dailyPuzzleId,
      message: 'Daily puzzle created successfully'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating daily puzzle:', error);
    
    if (error.constraint === 'daily_puzzles_date_key') {
      res.status(409).json({ error: 'A daily puzzle already exists for this date' });
    } else {
      res.status(500).json({ error: 'Failed to create daily puzzle' });
    }
  } finally {
    client.release();
  }
});

// Update daily puzzle
router.put('/daily-puzzles/:id', requireAuth, async (req, res) => {
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

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Update daily puzzle
    const updateResult = await client.query(`
      UPDATE daily_puzzles 
      SET date = $1, difficulty = $2
      WHERE id = $3
    `, [date, difficulty || 1, id]);

    if (updateResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Daily puzzle not found' });
    }

    // Delete existing clues
    await client.query(`DELETE FROM puzzle_clues WHERE daily_puzzle_id = $1`, [id]);

    // Insert new clues
    for (let i = 0; i < clues.length; i++) {
      const clue = clues[i];
      await client.query(`
        INSERT INTO puzzle_clues (daily_puzzle_id, clue_number, clue, answer, linking_word)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        id,
        i + 1,
        clue.clue,
        clue.answer.toUpperCase(),
        clue.linkingWord.toUpperCase()
      ]);
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Daily puzzle updated successfully'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating daily puzzle:', error);
    
    if (error.constraint === 'daily_puzzles_date_key') {
      res.status(409).json({ error: 'A daily puzzle already exists for this date' });
    } else {
      res.status(500).json({ error: 'Failed to update daily puzzle' });
    }
  } finally {
    client.release();
  }
});

// Delete daily puzzle
router.delete('/daily-puzzles/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    // Check if puzzle has game results
    const resultCountResult = await pool.query(`
      SELECT COUNT(*) as result_count
      FROM game_results
      WHERE daily_puzzle_id = $1
    `, [id]);

    const resultCount = parseInt(resultCountResult.rows[0].result_count);

    if (resultCount > 0) {
      // Don't delete, just deactivate
      const updateResult = await pool.query(`
        UPDATE daily_puzzles 
        SET is_active = false
        WHERE id = $1
      `, [id]);

      if (updateResult.rowCount === 0) {
        return res.status(404).json({ error: 'Daily puzzle not found' });
      }

      res.json({
        success: true,
        message: 'Daily puzzle deactivated (has existing game results)'
      });
    } else {
      // Safe to delete (will cascade to clues)
      const deleteResult = await pool.query(`
        DELETE FROM daily_puzzles
        WHERE id = $1
      `, [id]);

      if (deleteResult.rowCount === 0) {
        return res.status(404).json({ error: 'Daily puzzle not found' });
      }

      res.json({
        success: true,
        message: 'Daily puzzle deleted successfully'
      });
    }
  } catch (error) {
    console.error('Error deleting daily puzzle:', error);
    res.status(500).json({ error: 'Failed to delete daily puzzle' });
  }
});

// Get admin dashboard stats
router.get('/dashboard', requireAuth, async (req, res) => {
  const today = getTodayEastern();

  try {
    const statsResult = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM daily_puzzles WHERE is_active = true) as total_puzzles,
        (SELECT COUNT(*) FROM daily_puzzles WHERE date > $1 AND is_active = true) as future_puzzles,
        (SELECT COUNT(*) FROM daily_puzzles WHERE date = $1 AND is_active = true) as today_puzzle,
        (SELECT COUNT(*) FROM game_results WHERE DATE(completed_at) = $1) as today_plays,
        (SELECT COUNT(*) FROM users WHERE is_admin = false) as total_users,
        (SELECT AVG(score) FROM game_results WHERE DATE(completed_at) = $1) as today_avg_score,
        (SELECT COUNT(*) FROM game_results WHERE DATE(completed_at) >= CURRENT_DATE - INTERVAL '7 days') as week_plays
    `, [today]);

    res.json(statsResult.rows[0]);
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Bulk import daily puzzles
router.post('/daily-puzzles/bulk-import', requireAuth, async (req, res) => {
  const { dailyPuzzles } = req.body;

  if (!Array.isArray(dailyPuzzles) || dailyPuzzles.length === 0) {
    return res.status(400).json({ error: 'Daily puzzles array is required' });
  }

  const results = {
    successful: 0,
    failed: 0,
    errors: []
  };

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (let index = 0; index < dailyPuzzles.length; index++) {
      const dailyPuzzle = dailyPuzzles[index];
      const { date, difficulty = 1, clues } = dailyPuzzle;

      // Validation
      if (!date || !clues || !Array.isArray(clues) || clues.length !== 5) {
        results.failed++;
        results.errors.push(`Daily puzzle ${index + 1}: Missing date or exactly 5 clues`);
        continue;
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

      if (clueError) continue;

      try {
        // Insert daily puzzle (ON CONFLICT DO NOTHING for PostgreSQL)
        const dailyPuzzleResult = await client.query(`
          INSERT INTO daily_puzzles (date, difficulty, created_by)
          VALUES ($1, $2, $3)
          ON CONFLICT (date) DO NOTHING
          RETURNING id
        `, [date, difficulty, req.user.id]);

        if (dailyPuzzleResult.rows.length > 0) {
          const dailyPuzzleId = dailyPuzzleResult.rows[0].id;
          
          // Insert clues
          for (let i = 0; i < clues.length; i++) {
            const clue = clues[i];
            await client.query(`
              INSERT INTO puzzle_clues (daily_puzzle_id, clue_number, clue, answer, linking_word)
              VALUES ($1, $2, $3, $4, $5)
            `, [
              dailyPuzzleId,
              i + 1,
              clue.clue,
              clue.answer.toUpperCase(),
              clue.linkingWord.toUpperCase()
            ]);
          }
          
          results.successful++;
        } else {
          results.failed++;
          results.errors.push(`Daily puzzle ${index + 1}: Date already exists`);
        }
      } catch (error) {
        results.failed++;
        results.errors.push(`Daily puzzle ${index + 1}: ${error.message}`);
      }
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      ...results,
      message: `Import complete: ${results.successful} successful, ${results.failed} failed`
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Bulk import error:', error);
    res.status(500).json({ error: 'Transaction failed' });
  } finally {
    client.release();
  }
});

// Legacy support - keep old endpoints working temporarily
router.get('/puzzles', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.*,
        u.username as created_by_username,
        0 as completion_count
      FROM puzzles p
      LEFT JOIN users u ON p.created_by = u.id
      WHERE p.migrated = false OR p.migrated IS NULL
      ORDER BY p.date DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Legacy puzzles error:', error);
    res.status(500).json({ error: 'Database error' });
  }
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
