const express = require('express');
const pool = require('../db-connection');

const router = express.Router();

// Helper function to normalize answer for comparison (strips punctuation, keeps only letters and spaces)
function normalizeAnswer(answer) {
  return answer
    .toUpperCase()
    .replace(/[^A-Z\s]/g, '') // Remove everything except letters and spaces
    .replace(/\s+/g, ' ')     // Normalize multiple spaces to single space
    .trim();
}

// Helper function to get today's date in Eastern Time
function getTodayEastern() {
  const now = new Date();
  const easternDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const year = easternDate.getFullYear();
  const month = String(easternDate.getMonth() + 1).padStart(2, '0');
  const day = String(easternDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get today's daily puzzle (UPDATED - returns 5 clues)
router.get('/today', async (req, res) => {
  const today = getTodayEastern();

  try {
    // Get daily puzzle
    const dailyPuzzleResult = await pool.query(`
      SELECT id, date, difficulty, plays, avg_score, avg_time
      FROM daily_puzzles 
      WHERE date = $1 AND is_active = true
    `, [today]);

    const dailyPuzzle = dailyPuzzleResult.rows[0];

    if (!dailyPuzzle) {
      return res.status(404).json({ 
        error: 'No puzzle available for today',
        date: today 
      });
    }

    // Get clues for this daily puzzle
    const cluesResult = await pool.query(`
      SELECT clue_number, clue, answer, linking_word
      FROM puzzle_clues
      WHERE daily_puzzle_id = $1
      ORDER BY clue_number
    `, [dailyPuzzle.id]);

    const clues = cluesResult.rows;
    
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
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Validate answer for specific clue (NEW)
router.post('/validate-clue', async (req, res) => {
  const { clue_number, answer } = req.body;
  const today = getTodayEastern();
  
  if (!clue_number || !answer || typeof answer !== 'string') {
    return res.status(400).json({ error: 'Clue number and answer are required' });
  }

  try {
    // Get today's daily puzzle
    const dailyPuzzleResult = await pool.query(`
      SELECT id FROM daily_puzzles 
      WHERE date = $1 AND is_active = true
    `, [today]);

    const dailyPuzzle = dailyPuzzleResult.rows[0];

    if (!dailyPuzzle) {
      return res.status(404).json({ error: 'No puzzle available for today' });
    }

    // Get the specific clue
    const clueResult = await pool.query(`
      SELECT clue_number, answer, linking_word
      FROM puzzle_clues 
      WHERE daily_puzzle_id = $1 AND clue_number = $2
    `, [dailyPuzzle.id, clue_number]);

    const clue = clueResult.rows[0];
    
    if (!clue) {
      return res.status(404).json({ error: 'Clue not found' });
    }

    // Normalize both answers for comparison (strips punctuation like apostrophes and hyphens)
    const isCorrect = normalizeAnswer(answer) === normalizeAnswer(clue.answer);
    
    res.json({
      correct: isCorrect,
      clue_number: clue.clue_number,
      daily_puzzle_id: dailyPuzzle.id,
      ...(isCorrect && { 
        linking_word: clue.linking_word,
        full_answer: clue.answer 
      })
    });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get hint for specific clue (UPDATED - now supports word-specific hints)
router.post('/get-hint', async (req, res) => {
  const { clue_number, word_index, hint_type } = req.body;
  const today = getTodayEastern();
  
  // Validate input
  if (!clue_number) {
    return res.status(400).json({ error: 'Clue number is required' });
  }
  
  // For initial structure hint, word_index and hint_type are optional
  if (word_index !== undefined && !hint_type) {
    return res.status(400).json({ error: 'hint_type is required when word_index is specified' });
  }

  try {
    // Get today's daily puzzle
    const dailyPuzzleResult = await pool.query(`
      SELECT id FROM daily_puzzles 
      WHERE date = $1 AND is_active = true
    `, [today]);

    const dailyPuzzle = dailyPuzzleResult.rows[0];

    if (!dailyPuzzle) {
      return res.status(404).json({ error: 'No puzzle available for today' });
    }

    // Get the specific clue
    const clueResult = await pool.query(`
      SELECT clue_number, clue, answer, linking_word
      FROM puzzle_clues 
      WHERE daily_puzzle_id = $1 AND clue_number = $2
    `, [dailyPuzzle.id, clue_number]);

    const clue = clueResult.rows[0];
    
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
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

function generateWordSpecificHint(answer, linkingWord, wordIndex, hintType) {
  const words = answer.split(' ');
  const linkIndex = words.findIndex((word, index) => 
    word === linkingWord && index > 0 && index < words.length - 1
  );
  
  // Helper to generate letter array with punctuation pre-revealed
  function generateLetterArray(word, revealType = 'empty') {
    const letters = [];
    let firstLetterRevealed = false;
    
    for (let i = 0; i < word.length; i++) {
      const char = word[i];
      const isLetter = /[A-Za-z]/.test(char);
      
      if (!isLetter) {
        // Punctuation is always revealed
        letters.push({ char: char, isPunctuation: true });
      } else if (revealType === 'full_word') {
        // Full reveal - show all letters
        letters.push({ char: char.toUpperCase(), isPunctuation: false });
      } else if (revealType === 'first_letter' && !firstLetterRevealed) {
        // First letter reveal - show first actual letter
        letters.push({ char: char.toUpperCase(), isPunctuation: false });
        firstLetterRevealed = true;
      } else {
        // Blank
        letters.push({ char: '_', isPunctuation: false });
      }
    }
    
    return letters;
  }
  
  // Convert letter array to simple array of display characters
  function toDisplayArray(letterArray) {
    return letterArray.map(l => l.char);
  }
  
  // If no word_index specified, return initial structure
  if (wordIndex === undefined) {
    return {
      hint_type: 'structure',
      word_structure: words.map((word, index) => {
        const letterArray = generateLetterArray(word, 'empty');
        return {
          word_index: index,
          length: word.length,
          is_linking: index === linkIndex,
          letters: toDisplayArray(letterArray),
          state: 'empty', // empty, first_letter, full_word
          clickable: index !== linkIndex // Non-linking words are clickable initially
        };
      }),
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
        letters = toDisplayArray(generateLetterArray(word, 'first_letter'));
        state = 'first_letter';
        clickable = true; // Can click again for full word
      } else if (hintType === 'full_word') {
        letters = toDisplayArray(generateLetterArray(word, 'full_word'));
        state = 'full_word';
        clickable = false; // No more hints available for this word
      }
    } else {
      // Other words - return as blanks with punctuation revealed (frontend will maintain state)
      letters = toDisplayArray(generateLetterArray(word, 'empty'));
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
router.post('/get-hint-state', async (req, res) => {
  const { clue_number } = req.body;
  const today = getTodayEastern();
  
  if (!clue_number) {
    return res.status(400).json({ error: 'Clue number is required' });
  }

  try {
    // Get today's daily puzzle
    const dailyPuzzleResult = await pool.query(`
      SELECT id FROM daily_puzzles 
      WHERE date = $1 AND is_active = true
    `, [today]);

    const dailyPuzzle = dailyPuzzleResult.rows[0];

    if (!dailyPuzzle) {
      return res.status(404).json({ error: 'No puzzle available for today' });
    }

    // Get the specific clue
    const clueResult = await pool.query(`
      SELECT clue_number, answer, linking_word
      FROM puzzle_clues 
      WHERE daily_puzzle_id = $1 AND clue_number = $2
    `, [dailyPuzzle.id, clue_number]);

    const clue = clueResult.rows[0];
    
    if (!clue) {
      return res.status(404).json({ error: 'Clue not found' });
    }

    const words = clue.answer.split(' ');
    const linkIndex = words.findIndex((word, index) => 
      word === clue.linking_word && index > 0 && index < words.length - 1
    );
    
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
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Validate all 5 answers at once (NEW)
router.post('/validate-all', async (req, res) => {
  const { answers } = req.body;
  const today = getTodayEastern();
  
  if (!answers || !Array.isArray(answers) || answers.length !== 5) {
    return res.status(400).json({ error: 'Exactly 5 answers are required' });
  }

  try {
    // Get today's daily puzzle
    const dailyPuzzleResult = await pool.query(`
      SELECT id FROM daily_puzzles 
      WHERE date = $1 AND is_active = true
    `, [today]);

    const dailyPuzzle = dailyPuzzleResult.rows[0];

    if (!dailyPuzzle) {
      return res.status(404).json({ error: 'No puzzle available for today' });
    }

    // Get all clues for validation
    const cluesResult = await pool.query(`
      SELECT clue_number, answer, linking_word
      FROM puzzle_clues 
      WHERE daily_puzzle_id = $1
      ORDER BY clue_number
    `, [dailyPuzzle.id]);

    const clues = cluesResult.rows;
    
    if (clues.length !== 5) {
      return res.status(500).json({ error: 'Invalid puzzle configuration' });
    }

    // Validate each answer
    const results = clues.map((clue, index) => {
      const userAnswer = answers[index];
      const isCorrect = userAnswer && 
                       normalizeAnswer(userAnswer) === normalizeAnswer(clue.answer);
      
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
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Submit daily game result (UPDATED with test flag)
router.post('/submit-result', async (req, res) => {
  const {
    score,
    completionTime,
    hintsUsed,
    wrongAnswers,
    hintBreakdown,
    clueResults,
    userId, // Optional - for logged in users
    isTest  // NEW: Flag to mark test plays
  } = req.body;

  if (!score || !completionTime) {
    return res.status(400).json({ error: 'Score and completion time are required' });
  }

  // Don't save test results - just acknowledge them
  if (isTest) {
    return res.json({
      success: true,
      isTest: true,
      message: 'Test result acknowledged but not saved to statistics'
    });
  }

  const today = getTodayEastern();

  try {
    // Get today's daily puzzle ID
    const dailyPuzzleResult = await pool.query(`
      SELECT id FROM daily_puzzles 
      WHERE date = $1 AND is_active = true
    `, [today]);

    const dailyPuzzle = dailyPuzzleResult.rows[0];

    if (!dailyPuzzle) {
      return res.status(404).json({ error: 'No active daily puzzle for today' });
    }

    // Insert the game result
    const gameResultResult = await pool.query(`
      INSERT INTO game_results 
      (user_id, daily_puzzle_id, score, completion_time, hints_used, wrong_answers, hint_breakdown, clue_results)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      userId || null,
      dailyPuzzle.id,
      score,
      completionTime,
      hintsUsed || 0,
      wrongAnswers || 0,
      JSON.stringify(hintBreakdown || {}),
      JSON.stringify(clueResults || [])
    ]);

    const resultId = gameResultResult.rows[0].id;

    // Update daily puzzle statistics
    await pool.query(`
      UPDATE daily_puzzles 
      SET plays = plays + 1,
          avg_score = (
            SELECT AVG(score) 
            FROM game_results 
            WHERE daily_puzzle_id = $1
          ),
          avg_time = (
            SELECT AVG(completion_time) 
            FROM game_results 
            WHERE daily_puzzle_id = $1
          )
      WHERE id = $1
    `, [dailyPuzzle.id]);

    res.json({
      success: true,
      resultId: resultId,
      message: 'Result saved successfully'
    });
  } catch (error) {
    console.error('Error submitting result:', error);
    res.status(500).json({ error: 'Failed to save result' });
  }
});

// Get daily puzzle statistics (UPDATED)
router.get('/stats/:date?', async (req, res) => {
  const date = req.params.date || getTodayEastern();

  try {
    const statsResult = await pool.query(`
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
      WHERE dp.date = $1
      GROUP BY dp.id, dp.date, dp.plays, dp.avg_score, dp.avg_time, dp.difficulty
    `, [date]);

    const stats = statsResult.rows[0];
    
    if (!stats) {
      return res.status(404).json({ error: 'No daily puzzle found for this date' });
    }

    res.json(stats);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Database error' });
  }
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
router.get('/date/:date', requireAuth, async (req, res) => {
  const { date } = req.params;

  try {
    // Get daily puzzle
    const dailyPuzzleResult = await pool.query(`
      SELECT * FROM daily_puzzles 
      WHERE date = $1
    `, [date]);

    const dailyPuzzle = dailyPuzzleResult.rows[0];

    if (!dailyPuzzle) {
      return res.status(404).json({ error: 'Daily puzzle not found' });
    }

    // Get clues
    const cluesResult = await pool.query(`
      SELECT clue_number, clue, answer, linking_word
      FROM puzzle_clues
      WHERE daily_puzzle_id = $1
      ORDER BY clue_number
    `, [dailyPuzzle.id]);

    const clues = cluesResult.rows;

    res.json({
      ...dailyPuzzle,
      clues: clues
    });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Test endpoint - returns answers for automated testing (requires admin auth)
router.get('/:id/test-answers', requireAuth, async (req, res) => {
  const puzzleId = req.params.id;
  
  try {
    // Get the puzzle
    const puzzleResult = await pool.query(
      'SELECT * FROM daily_puzzles WHERE id = $1',
      [puzzleId]
    );
    
    const puzzle = puzzleResult.rows[0];
    
    if (!puzzle) {
      return res.status(404).json({ error: 'Puzzle not found' });
    }
    
    // Get clues with answers
    const cluesResult = await pool.query(
      'SELECT clue_number, answer FROM puzzle_clues WHERE daily_puzzle_id = $1 ORDER BY clue_number',
      [puzzleId]
    );
    
    const clues = cluesResult.rows;
    
    res.json({ 
      puzzle_id: puzzle.id,
      date: puzzle.date,
      answers: clues 
    });
  } catch (error) {
    console.error('Error fetching test answers:', error);
    res.status(500).json({ error: error.message });
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
