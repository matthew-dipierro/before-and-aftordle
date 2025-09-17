// routes/clue-library.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const router = express.Router();
const DB_PATH = path.join(__dirname, '..', 'database.sqlite');

// Simple auth middleware (reuse from existing admin.js)
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

// ===== CLUE LIBRARY MANAGEMENT =====

// Get all clues with filters
router.get('/clues', (req, res) => {
  const { search, difficulty, used, category, limit, offset } = req.query;
  
  let query = `
    SELECT cl.*, 
           COUNT(pc.id) as usage_count,
           MAX(dp.date) as last_used_date
    FROM clue_library cl
    LEFT JOIN puzzle_clues pc ON cl.id = pc.source_clue_id
    LEFT JOIN daily_puzzles dp ON pc.daily_puzzle_id = dp.id
    WHERE cl.is_active = 1
  `;
  
  const params = [];
  
  if (search) {
    query += ` AND (cl.clue LIKE ? OR cl.answer LIKE ? OR cl.category LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  
  if (difficulty) {
    query += ` AND cl.difficulty = ?`;
    params.push(difficulty);
  }
  
  if (used === 'true') {
    query += ` AND cl.used = 1`;
  } else if (used === 'false') {
    query += ` AND cl.used = 0`;
  }
  
  if (category) {
    query += ` AND cl.category = ?`;
    params.push(category);
  }
  
  query += ` GROUP BY cl.id ORDER BY cl.created_at DESC`;
  
  if (limit) {
    query += ` LIMIT ?`;
    params.push(parseInt(limit));
    
    if (offset) {
      query += ` OFFSET ?`;
      params.push(parseInt(offset));
    }
  }

  const db = new sqlite3.Database(DB_PATH);
  
  db.all(query, params, (err, clues) => {
    if (err) {
      db.close();
      return res.status(500).json({ error: 'Database error: ' + err.message });
    }
    
    // Get total count for pagination
    let countQuery = `SELECT COUNT(DISTINCT cl.id) as total FROM clue_library cl WHERE cl.is_active = 1`;
    const countParams = [];
    
    if (search) {
      countQuery += ` AND (cl.clue LIKE ? OR cl.answer LIKE ? OR cl.category LIKE ?)`;
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    if (difficulty) {
      countQuery += ` AND cl.difficulty = ?`;
      countParams.push(difficulty);
    }
    
    if (used === 'true') {
      countQuery += ` AND cl.used = 1`;
    } else if (used === 'false') {
      countQuery += ` AND cl.used = 0`;
    }
    
    if (category) {
      countQuery += ` AND cl.category = ?`;
      countParams.push(category);
    }
    
    db.get(countQuery, countParams, (err, countResult) => {
      db.close();
      
      if (err) {
        return res.status(500).json({ error: 'Database error: ' + err.message });
      }
      
      res.json({
        clues: clues.map(clue => ({
          ...clue,
          tags: clue.tags ? JSON.parse(clue.tags) : [],
          last_used: clue.last_used_date
        })),
        total: countResult.total,
        pagination: {
          limit: parseInt(limit) || null,
          offset: parseInt(offset) || 0,
          hasMore: countResult.total > (parseInt(offset) || 0) + clues.length
        }
      });
    });
  });
});

// Get library statistics
router.get('/stats', (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  
  const queries = {
    total: 'SELECT COUNT(*) as count FROM clue_library WHERE is_active = 1',
    unused: 'SELECT COUNT(*) as count FROM clue_library WHERE used = 0 AND is_active = 1',
    categories: 'SELECT category, COUNT(*) as count FROM clue_library WHERE category IS NOT NULL AND category != "" AND is_active = 1 GROUP BY category',
    difficultyBreakdown: 'SELECT difficulty, COUNT(*) as count FROM clue_library WHERE is_active = 1 GROUP BY difficulty'
  };
  
  const stats = {};
  let completed = 0;
  const totalQueries = Object.keys(queries).length;
  
  Object.entries(queries).forEach(([key, query]) => {
    db.all(query, (err, result) => {
      if (!err) {
        if (key === 'categories' || key === 'difficultyBreakdown') {
          stats[key] = result;
        } else {
          stats[key] = result[0]?.count || 0;
        }
      }
      
      completed++;
      if (completed === totalQueries) {
        db.close();
        
        const possiblePuzzles = Math.floor(stats.unused / 5);
        
        res.json({
          totalClues: stats.total,
          unusedClues: stats.unused,
          possiblePuzzles,
          daysOfContent: possiblePuzzles,
          categories: stats.categories || [],
          difficultyBreakdown: stats.difficultyBreakdown || []
        });
      }
    });
  });
});

// Add new clue
router.post('/clues', requireAuth, (req, res) => {
  const { clue, answer, linking_word, difficulty, category, tags } = req.body;
  
  // Validation
  if (!clue || !answer || !linking_word) {
    return res.status(400).json({ error: 'Clue, answer, and linking word are required' });
  }
  
  if (!answer.toUpperCase().includes(linking_word.toUpperCase())) {
    return res.status(400).json({ error: 'Linking word must appear in the answer' });
  }
  
  const db = new sqlite3.Database(DB_PATH);
  
  db.run(`
    INSERT INTO clue_library (
      clue, answer, linking_word, difficulty, category, tags,
      used, created_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'), ?)
  `, [
    clue,
    answer.toUpperCase(),
    linking_word.toUpperCase(),
    difficulty || 2,
    category || null,
    tags ? JSON.stringify(tags) : null,
    req.user.id
  ], function(err) {
    db.close();
    
    if (err) {
      return res.status(500).json({ error: 'Failed to add clue: ' + err.message });
    }
    
    res.json({
      id: this.lastID,
      message: 'Clue added successfully'
    });
  });
});

// Update existing clue
router.put('/clues/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { clue, answer, linking_word, difficulty, category, tags } = req.body;
  
  // Validation
  if (!clue || !answer || !linking_word) {
    return res.status(400).json({ error: 'Clue, answer, and linking word are required' });
  }
  
  if (!answer.toUpperCase().includes(linking_word.toUpperCase())) {
    return res.status(400).json({ error: 'Linking word must appear in the answer' });
  }
  
  const db = new sqlite3.Database(DB_PATH);
  
  db.run(`
    UPDATE clue_library 
    SET clue = ?, answer = ?, linking_word = ?, difficulty = ?, 
        category = ?, tags = ?, updated_at = datetime('now')
    WHERE id = ? AND is_active = 1
  `, [
    clue,
    answer.toUpperCase(),
    linking_word.toUpperCase(),
    difficulty || 2,
    category || null,
    tags ? JSON.stringify(tags) : null,
    id
  ], function(err) {
    db.close();
    
    if (err) {
      return res.status(500).json({ error: 'Failed to update clue: ' + err.message });
    }
    
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Clue not found' });
    }
    
    res.json({ message: 'Clue updated successfully' });
  });
});

// Delete clue (soft delete - mark as inactive)
router.delete('/clues/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  
  const db = new sqlite3.Database(DB_PATH);
  
  db.run(`
    UPDATE clue_library 
    SET is_active = 0, updated_at = datetime('now')
    WHERE id = ?
  `, [id], function(err) {
    db.close();
    
    if (err) {
      return res.status(500).json({ error: 'Failed to delete clue: ' + err.message });
    }
    
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Clue not found' });
    }
    
    res.json({ message: 'Clue deleted successfully' });
  });
});

// ===== PUZZLE GENERATION =====

// Generate single puzzle from library
router.post('/generate-puzzle', requireAuth, (req, res) => {
  const { date, target_difficulty, theme } = req.body;
  
  if (!date) {
    return res.status(400).json({ error: 'Date is required' });
  }
  
  const db = new sqlite3.Database(DB_PATH);
  
  // Check if puzzle already exists for this date
  db.get('SELECT id FROM daily_puzzles WHERE date = ?', [date], (err, existing) => {
    if (err) {
      db.close();
      return res.status(500).json({ error: 'Database error: ' + err.message });
    }
    
    if (existing) {
      db.close();
      return res.status(400).json({ error: 'Puzzle already exists for this date' });
    }
    
    // Get available unused clues
    let clueQuery = `
      SELECT * FROM clue_library 
      WHERE used = 0 AND is_active = 1
    `;
    const clueParams = [];
    
    if (theme) {
      clueQuery += ` AND (category LIKE ? OR tags LIKE ?)`;
      clueParams.push(`%${theme}%`, `%${theme}%`);
    }
    
    clueQuery += ` ORDER BY RANDOM()`;
    
    db.all(clueQuery, clueParams, (err, availableClues) => {
      if (err) {
        db.close();
        return res.status(500).json({ error: 'Database error: ' + err.message });
      }
      
      if (availableClues.length < 5) {
        db.close();
        return res.status(400).json({ 
          error: `Only ${availableClues.length} unused clues available. Need at least 5.` 
        });
      }
      
      // Smart selection algorithm
      const selectedClues = smartSelectClues(availableClues, target_difficulty);
      
      db.close();
      res.json({
        date,
        difficulty: calculateAverageDifficulty(selectedClues),
        clues: selectedClues.map((clue, index) => ({
          clue_number: index + 1,
          clue: clue.clue,
          answer: clue.answer,
          linking_word: clue.linking_word,
          source_clue_id: clue.id
        }))
      });
    });
  });
});

// Save generated puzzle
router.post('/save-generated-puzzle', requireAuth, (req, res) => {
  const { date, difficulty, clues } = req.body;
  
  if (!date || !clues || clues.length !== 5) {
    return res.status(400).json({ error: 'Date and exactly 5 clues are required' });
  }
  
  const db = new sqlite3.Database(DB_PATH);
  
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    // Create daily puzzle
    db.run(`
      INSERT INTO daily_puzzles (date, difficulty, created_by, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `, [date, difficulty || 2, req.user.id], function(err) {
      if (err) {
        db.run('ROLLBACK');
        db.close();
        return res.status(500).json({ error: 'Failed to create puzzle: ' + err.message });
      }
      
      const dailyPuzzleId = this.lastID;
      let cluesToProcess = clues.length;
      let errors = [];
      
      // Add each clue
      clues.forEach((clue, index) => {
        db.run(`
          INSERT INTO puzzle_clues (
            daily_puzzle_id, clue_number, clue, answer, linking_word, source_clue_id
          ) VALUES (?, ?, ?, ?, ?, ?)
        `, [
          dailyPuzzleId,
          clue.clue_number,
          clue.clue,
          clue.answer,
          clue.linking_word,
          clue.source_clue_id
        ], function(err) {
          if (err) {
            errors.push(`Clue ${index + 1}: ${err.message}`);
          }
          
          cluesToProcess--;
          
          if (cluesToProcess === 0) {
            if (errors.length > 0) {
              db.run('ROLLBACK');
              db.close();
              return res.status(500).json({ 
                error: 'Failed to add clues', 
                details: errors 
              });
            }
            
            // Mark source clues as used
            const sourceClueIds = clues.map(c => c.source_clue_id).filter(id => id);
            if (sourceClueIds.length > 0) {
              const placeholders = sourceClueIds.map(() => '?').join(',');
              db.run(`
                UPDATE clue_library 
                SET used = 1, last_used_date = ?, updated_at = datetime('now')
                WHERE id IN (${placeholders})
              `, [date, ...sourceClueIds], (err) => {
                if (err) {
                  console.error('Failed to mark clues as used:', err);
                  // Don't fail the whole operation for this
                }
                
                db.run('COMMIT');
                db.close();
                
                res.json({
                  id: dailyPuzzleId,
                  message: 'Puzzle saved successfully'
                });
              });
            } else {
              db.run('COMMIT');
              db.close();
              
              res.json({
                id: dailyPuzzleId,
                message: 'Puzzle saved successfully'
              });
            }
          }
        });
      });
    });
  });
});

// ===== UTILITY FUNCTIONS =====

function smartSelectClues(availableClues, targetDifficulty) {
  let selected = [];
  
  if (targetDifficulty === 'mixed' || !targetDifficulty) {
    // Select mix: 1-2 easy, 2-3 medium, 1-2 hard
    const easy = availableClues.filter(c => c.difficulty === 1);
    const medium = availableClues.filter(c => c.difficulty === 2);
    const hard = availableClues.filter(c => c.difficulty === 3);
    
    // Try to get balanced mix
    selected.push(...easy.slice(0, 2));
    selected.push(...medium.slice(0, 2));
    selected.push(...hard.slice(0, 1));
    
    // Fill remaining slots
    while (selected.length < 5) {
      const remaining = availableClues.filter(c => !selected.includes(c));
      if (remaining.length === 0) break;
      selected.push(remaining[0]);
    }
  } else {
    // Select specific difficulty
    const difficulty = parseInt(targetDifficulty);
    const filtered = availableClues.filter(c => c.difficulty === difficulty);
    selected = filtered.slice(0, 5);
    
    // Fill with any difficulty if not enough
    if (selected.length < 5) {
      const remaining = availableClues.filter(c => !selected.includes(c));
      selected.push(...remaining.slice(0, 5 - selected.length));
    }
  }
  
  return selected.slice(0, 5);
}

function calculateAverageDifficulty(clues) {
  const sum = clues.reduce((acc, clue) => acc + clue.difficulty, 0);
  return Math.round(sum / clues.length);
}

// ===== BULK OPERATIONS =====

// Bulk import clues from CSV
router.post('/bulk-import-clues', requireAuth, (req, res) => {
  const { clues } = req.body;
  
  if (!clues || !Array.isArray(clues)) {
    return res.status(400).json({ error: 'Clues array is required' });
  }
  
  const db = new sqlite3.Database(DB_PATH);
  
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    let successful = 0;
    let failed = 0;
    let errors = [];
    
    clues.forEach((clue, index) => {
      // Validate each clue
      if (!clue.clue || !clue.answer || !clue.linking_word) {
        failed++;
        errors.push(`Row ${index + 1}: Missing required fields`);
        return;
      }
      
      if (!clue.answer.toUpperCase().includes(clue.linking_word.toUpperCase())) {
        failed++;
        errors.push(`Row ${index + 1}: Linking word not found in answer`);
        return;
      }
      
      db.run(`
        INSERT INTO clue_library (
          clue, answer, linking_word, difficulty, category, tags,
          used, created_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'), ?)
      `, [
        clue.clue,
        clue.answer.toUpperCase(),
        clue.linking_word.toUpperCase(),
        clue.difficulty || 2,
        clue.category || null,
        clue.tags ? JSON.stringify(clue.tags) : null,
        req.user.id
      ], function(err) {
        if (err) {
          failed++;
          errors.push(`Row ${index + 1}: ${err.message}`);
        } else {
          successful++;
        }
        
        // Check if we're done processing
        if (successful + failed === clues.length) {
          if (successful > 0) {
            db.run('COMMIT');
          } else {
            db.run('ROLLBACK');
          }
          
          db.close();
          
          res.json({
            successful,
            failed,
            errors: errors.slice(0, 10), // Limit error list
            message: `Import complete: ${successful} successful, ${failed} failed`
          });
        }
      });
    });
  });
});

// Export clues to CSV format
router.get('/export-clues', (req, res) => {
  const { format } = req.query;
  
  const db = new sqlite3.Database(DB_PATH);
  
  db.all(`
    SELECT clue, answer, linking_word, difficulty, category, tags,
           used, created_at, last_used_date
    FROM clue_library 
    WHERE is_active = 1
    ORDER BY created_at DESC
  `, [], (err, clues) => {
    db.close();
    
    if (err) {
      return res.status(500).json({ error: 'Database error: ' + err.message });
    }
    
    if (format === 'json') {
      res.json({
        clues: clues.map(clue => ({
          ...clue,
          tags: clue.tags ? JSON.parse(clue.tags) : []
        })),
        exported_at: new Date().toISOString(),
        total_count: clues.length
      });
    } else {
      // CSV format
      const csvHeaders = 'Clue,Answer,Linking Word,Difficulty,Category,Tags,Used,Created,Last Used\n';
      const csvRows = clues.map(clue => {
        const tags = clue.tags ? JSON.parse(clue.tags).join(';') : '';
        return [
          `"${clue.clue.replace(/"/g, '""')}"`,
          clue.answer,
          clue.linking_word,
          clue.difficulty,
          clue.category || '',
          tags,
          clue.used ? 'Yes' : 'No',
          clue.created_at,
          clue.last_used_date || ''
        ].join(',');
      }).join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="clue-library-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csvHeaders + csvRows);
    }
  });
});

module.exports = router;
