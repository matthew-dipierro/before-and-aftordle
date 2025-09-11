const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const router = express.Router();
const DB_PATH = path.join(__dirname, '..', 'database.sqlite');

// Get today's daily puzzle (UPDATED - returns 5 clues)
router.get('/today', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const db = new sqlite3.Database(DB_PATH);

  // Get daily puzzle
  db.get(`
    SELECT id, date, difficulty, plays, avg_score, avg_time
    FROM daily_puzzles 
    WHERE date = ? AND is_active = 1
  `, [today], (err, dailyPuzzle) => {
    if (err) {
      db.close();
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!dailyPuzzle) {
      db.close();
      return res.status(404).json({ 
        error: 'No puzzle available for today',
        date: today 
      });
    }

    // Get clues for this daily puzzle
    db.all(`
      SELECT clue_number, clue, answer, linking_word
      FROM puzzle_clues
      WHERE daily_puzzle_id = ?
      ORDER BY clue_number
    `, [dailyPuzzle.id], (err, clues) => {
      db.close();
      
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (clues.length === 0) {
        return res.status(404).json({ 
          error: 'No clues found for today\'s puzzle',
          date: today 
        });
      }

      // Don't send answers to the client!
      const puzzleData = {
        id: dailyPuzzle.id,
        date: dailyPuzzle.date,
        difficulty: dailyPuzzle.difficulty,
        plays: dailyPuzzle.plays,
        avg_score: dailyPuzzle.avg_score,
        clues: clues.map(clue => ({
          clue_number: clue.clue_number,
          clue: clue.clue
        })),
        total_clues: clues.length
      };

      res.json(puzzleData);
    });
  });
});

// Validate answer for specific clue (NEW)
router.post('/validate-clue', (req, res) => {
  const { clue_number, answer } = req.body;
  const today = new Date().toISOString().split('T')[0];
  
  if (!clue_number || !answer || typeof answer !== 'string') {
    return res.status(400).json({ error: 'Clue number and answer are required' });
  }

  const db = new sqlite3.Database(DB_PATH);

  // Get today's daily puzzle
  db.get(`
    SELECT id FROM daily_puzzles 
    WHERE date = ? AND is_active = 1
  `, [today], (err, dailyPuzzle) => {
    if (err) {
      db.close();
      return res.status(500).json({ error: 'Database error' });
    }

    if (!dailyPuzzle) {
      db.close();
      return res.status(404).json({ error: 'No puzzle available for today' });
    }

    // Get the specific clue
    db.get(`
      SELECT clue_number, answer, linking_word
      FROM puzzle_clues 
      WHERE daily_puzzle_id = ? AND clue_number = ?
    `, [dailyPuzzle.id, clue_number], (err, clue) => {
      db.close();
      
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!clue) {
        return res.status(404).json({ error: 'Clue not found' });
      }

      const isCorrect = answer.toUpperCase().trim() === clue.answer.toUpperCase().trim();
      
      res.json({
        correct: isCorrect,
        clue_number: clue.clue_number,
        daily_puzzle_id: dailyPuzzle.id,
        ...(isCorrect && { 
          linking_word: clue.linking_word,
          full_answer: clue.answer 
        })
      });
    });
  });
});

// Get hint for specific clue (UPDATED - now supports word-specific hints)
router.post('/get-hint', (req, res) => {
  const { clue_number, word_index, hint_type } = req.body;
  const today = new Date().toISOString().split('T')[0];
  
  // Validate input
  if (!clue_number) {
    return res.status(400).json({ error: 'Clue number is required' });
  }
  
  // For initial structure hint, word_index and hint_type are optional
  if (word_index !== undefined && !hint_type) {
    return res.status(400).json({ error: 'hint_type is required when word_index is specified' });
  }

  const db = new sqlite3.Database(DB_PATH);

  // Get today's daily puzzle
  db.get(`
    SELECT id FROM daily_puzzles 
    WHERE date = ? AND is_active = 1
  `, [today], (err, dailyPuzzle) => {
    if (err) {
      db.close();
      return res.status(500).json({ error: 'Database error' });
    }

    if (!dailyPuzzle) {
      db.close();
      return res.status(404).json({ error: 'No puzzle available for today' });
    }

    // Get the specific clue
    db.get(`
      SELECT clue_number, clue, answer, linking_word
      FROM puzzle_clues 
      WHERE daily_puzzle_id = ? AND clue_number = ?
    `, [dailyPuzzle.id, clue_number], (err, clue) => {
      db.close();
      
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!clue) {
        return res.status(404).json({ error: 'Clue not found' });
      }

      // Generate hint based on request type
      const hintData = generateWordSpecificHint(clue.answer, clue.linking_word, word_index, hint_type);
      
      if (hintData.error) {
        return res.status(400).json(hintData);
      }
      
      res.json({
        clue_number: clue.clue_number,
        word_index: word_index,
        hint_type: hint_type || 'structure',
        ...hintData
      });
    });
  });
});

function generateWordSpecificHint(answer, linkingWord, wordIndex, hintType) {
  const words = answer.split(' ');
  const linkIndex = words.findIndex(word => word === linkingWord);
  
  // If no word_index specified, return initial structure
  if (wordIndex === undefined) {
    return {
      hint_type: 'structure',
      word_structure: words.map((word, index) => ({
        word_index: index,
        length: word.length,
        is_linking: index === linkIndex,
        letters: new Array(word.length).fill('_'),
        state: 'empty', // empty, first_letter, full_word
        clickable: index !== linkIndex // Non-linking words are clickable initially
      })),
      penalty: 5
    };
  }
  
  // Validate word_index
  if (wordIndex < 0 || wordIndex >= words.length) {
    return { error: 'Invalid word_index' };
  }
  
  // REMOVED the linking word check - let frontend handle this logic
  // The frontend already validates linking word availability before making the request
  
  // Validate hint_type
  if (!['first_letter', 'full_word', 'check_linking_available'].includes(hintType)) {
    return { error: 'Invalid hint_type. Must be first_letter, full_word, or check_linking_available' };
  }
  
  // Special endpoint to check if linking word is available
  if (hintType === 'check_linking_available') {
    return {
      hint_type: 'linking_available_check',
      linking_available: true, // Frontend will track state, this is just confirmation
      penalty: 0
    };
  }
  
  const targetWord = words[wordIndex];
  const isLinking = wordIndex === linkIndex;
  
  // Generate word structure with the requested hint applied
  const word_structure = words.map((word, index) => {
    let letters;
    let state;
    let clickable;
    
    if (index === wordIndex) {
      // This is the word being hinted
      if (hintType === 'first_letter') {
        letters = new Array(word.length).fill('_');
        letters[0] = word[0];
        state = 'first_letter';
        clickable = true; // Can click again for full word
      } else if (hintType === 'full_word') {
        letters = word.split('');
        state = 'full_word';
        clickable = false; // No more hints available for this word
      }
    } else {
      // Other words - return as blanks (frontend will maintain state)
      letters = new Array(word.length).fill('_');
      state = 'empty';
      clickable = index !== linkIndex; // Non-linking words are clickable
    }
    
    return {
      word_index: index,
      length: word.length,
      is_linking: index === linkIndex,
      letters: letters,
      state: state,
      clickable: clickable
    };
  });
  
  // Calculate penalty
  let penalty;
  if (isLinking && hintType === 'first_letter') {
    penalty = 5; // Linking word first letter
  } else if (isLinking && hintType === 'full_word') {
    penalty = 5; // Linking word full reveal
  } else {
    penalty = 3; // Regular word hints
  }
  
  return {
    hint_type: hintType,
    word_structure: word_structure,
    penalty: penalty,
    revealed_word: {
      word_index: wordIndex,
      word: targetWord,
      is_linking: isLinking
    }
  };
}

// New endpoint to get current hint state for a clue
router.post('/get-hint-state', (req, res) => {
  const { clue_number } = req.body;
  const today = new Date().toISOString().split('T')[0];
  
  if (!clue_number) {
    return res.status(400).json({ error: 'Clue number is required' });
  }

  const db = new sqlite3.Database(DB_PATH);

  // Get today's daily puzzle
  db.get(`
    SELECT id FROM daily_puzzles 
    WHERE date = ? AND is_active = 1
  `, [today], (err, dailyPuzzle) => {
    if (err) {
      db.close();
      return res.status(500).json({ error: 'Database error' });
    }

    if (!dailyPuzzle) {
      db.close();
      return res.status(404).json({ error: 'No puzzle available for today' });
    }

    // Get the specific clue
    db.get(`
      SELECT clue_number, answer, linking_word
      FROM puzzle_clues 
      WHERE daily_puzzle_id = ? AND clue_number = ?
    `, [dailyPuzzle.id, clue_number], (err, clue) => {
      db.close();
      
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!clue) {
        return res.status(404).json({ error: 'Clue not found' });
      }

      const words = clue.answer.split(' ');
      const linkIndex = words.findIndex(word => word === clue.linking_word);
      
      // Return clean state for frontend to manage
      const word_structure = words.map((word, index) => ({
        word_index: index,
        length: word.length,
        is_linking: index === linkIndex,
        letters: new Array(word.length).fill('_'),
        state: 'empty',
        clickable: index !== linkIndex
      }));
      
      res.json({
        clue_number: clue.clue_number,
        word_structure: word_structure,
        structure_revealed: false
      });
    });
  });
});

// Validate all 5 answers at once (NEW)
router.post('/validate-all', (req, res) => {
  const { answers } = req.body;
  const today = new Date().toISOString().split('T')[0];
  
  if (!answers || !Array.isArray(answers) || answers.length !== 5) {
    return res.status(400).json({ error: 'Exactly 5 answers are required' });
  }

  const db = new sqlite3.Database(DB_PATH);

  // Get today's daily puzzle
  db.get(`
    SELECT id FROM daily_puzzles 
    WHERE date = ? AND is_active = 1
  `, [today], (err, dailyPuzzle) => {
    if (err) {
      db.close();
      return res.status(500).json({ error: 'Database error' });
    }

    if (!dailyPuzzle) {
      db.close();
      return res.status(404).json({ error: 'No puzzle available for today' });
    }

    // Get all clues for validation
    db.all(`
      SELECT clue_number, answer, linking_word
      FROM puzzle_clues 
      WHERE daily_puzzle_id = ?
      ORDER BY clue_number
    `, [dailyPuzzle.id], (err, clues) => {
      db.close();
      
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (clues.length !== 5) {
        return res.status(500).json({ error: 'Invalid puzzle configuration' });
      }

      // Validate each answer
      const results = clues.map((clue, index) => {
        const userAnswer = answers[index];
        const isCorrect = userAnswer && 
                         userAnswer.toUpperCase().trim() === clue.answer.toUpperCase().trim();
        
        return {
          clue_number: clue.clue_number,
          correct: isCorrect,
          ...(isCorrect && {
            linking_word: clue.linking_word,
            full_answer: clue.answer
          })
        };
      });

      const allCorrect = results.every(r => r.correct);
      const correctCount = results.filter(r => r.correct).length;

      res.json({
        all_correct: allCorrect,
        correct_count: correctCount,
        daily_puzzle_id: dailyPuzzle.id,
        results: results
      });
    });
  });
});

// Submit daily game result (UPDATED)
router.post('/submit-result', (req, res) => {
  const {
    score,
    completionTime,
    hintsUsed,
    wrongAnswers,
    hintBreakdown,
    clueResults,
    userId // Optional - for logged in users
  } = req.body;

  if (!score || !completionTime) {
    return res.status(400).json({ error: 'Score and completion time are required' });
  }

  const today = new Date().toISOString().split('T')[0];
  const db = new sqlite3.Database(DB_PATH);

  // Get today's daily puzzle ID
  db.get(`
    SELECT id FROM daily_puzzles 
    WHERE date = ? AND is_active = 1
  `, [today], (err, dailyPuzzle) => {
    if (err || !dailyPuzzle) {
      db.close();
      return res.status(404).json({ error: 'No active daily puzzle for today' });
    }

    // Insert the game result
    db.run(`
      INSERT INTO game_results 
      (user_id, daily_puzzle_id, score, completion_time, hints_used, wrong_answers, hint_breakdown, clue_results)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId || null,
      dailyPuzzle.id,
      score,
      completionTime,
      hintsUsed || 0,
      wrongAnswers || 0,
      JSON.stringify(hintBreakdown || {}),
      JSON.stringify(clueResults || [])
    ], function(err) {
      if (err) {
        db.close();
        return res.status(500).json({ error: 'Failed to save result' });
      }

      // Update daily puzzle statistics
      db.run(`
        UPDATE daily_puzzles 
        SET plays = plays + 1,
            avg_score = (
              SELECT AVG(score) 
              FROM game_results 
              WHERE daily_puzzle_id = ?
            ),
            avg_time = (
              SELECT AVG(completion_time) 
              FROM game_results 
              WHERE daily_puzzle_id = ?
            )
        WHERE id = ?
      `, [dailyPuzzle.id, dailyPuzzle.id, dailyPuzzle.id], (err) => {
        db.close();
        
        if (err) {
          console.error('Error updating daily puzzle stats:', err);
        }

        res.json({
          success: true,
          resultId: this.lastID,
          message: 'Result saved successfully'
        });
      });
    });
  });
});

// Get daily puzzle statistics (UPDATED)
router.get('/stats/:date?', (req, res) => {
  const date = req.params.date || new Date().toISOString().split('T')[0];
  const db = new sqlite3.Database(DB_PATH);

  db.get(`
    SELECT 
      dp.date,
      dp.plays,
      dp.avg_score,
      dp.avg_time,
      dp.difficulty,
      COUNT(gr.id) as total_completions,
      AVG(gr.score) as actual_avg_score,
      MIN(gr.score) as min_score,
      MAX(gr.score) as max_score,
      AVG(gr.completion_time) as actual_avg_time,
      AVG(gr.hints_used) as avg_hints,
      AVG(gr.wrong_answers) as avg_wrong_answers
    FROM daily_puzzles dp
    LEFT JOIN game_results gr ON dp.id = gr.daily_puzzle_id
    WHERE dp.date = ?
    GROUP BY dp.id
  `, [date], (err, stats) => {
    db.close();
    
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!stats) {
      return res.status(404).json({ error: 'No daily puzzle found for this date' });
    }

    res.json(stats);
  });
});

// Legacy endpoints for backward compatibility
router.post('/validate', (req, res) => {
  // Redirect old single-answer validation to new format
  res.status(400).json({ 
    error: 'This endpoint is deprecated. Use /validate-clue or /validate-all instead.',
    migration: 'The game now uses daily puzzles with 5 clues each.'
  });
});

// Get daily puzzle by date (admin only)
router.get('/date/:date', requireAuth, (req, res) => {
  const { date } = req.params;
  const db = new sqlite3.Database(DB_PATH);

  // Get daily puzzle
  db.get(`
    SELECT * FROM daily_puzzles 
    WHERE date = ?
  `, [date], (err, dailyPuzzle) => {
    if (err) {
      db.close();
      return res.status(500).json({ error: 'Database error' });
    }

    if (!dailyPuzzle) {
      db.close();
      return res.status(404).json({ error: 'Daily puzzle not found' });
    }

    // Get clues
    db.all(`
      SELECT clue_number, clue, answer, linking_word
      FROM puzzle_clues
      WHERE daily_puzzle_id = ?
      ORDER BY clue_number
    `, [dailyPuzzle.id], (err, clues) => {
      db.close();
      
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({
        ...dailyPuzzle,
        clues: clues
      });
    });
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