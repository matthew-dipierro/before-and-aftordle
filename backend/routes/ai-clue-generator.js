// routes/ai-clue-generator.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const router = express.Router();
const DB_PATH = path.join(__dirname, '..', 'database.sqlite');

// AI Clue Generation Templates and Logic
class AIClueGenerator {
  constructor() {
    // Different clue styles for variety
    this.clueStyles = [
      'descriptive',
      'cryptic', 
      'wordplay',
      'cultural_reference',
      'definition',
      'example_based'
    ];
    
    // Prompt templates for different AI services
    this.promptTemplates = {
      openai: {
        systemPrompt: `You are a professional puzzle writer creating clues for "Before & After" style word puzzles. These puzzles combine two familiar phrases that share a common word.

For example: "BRUNO MARS ATTACKS" combines "Bruno Mars" (the singer) and "Mars Attacks" (the movie).

Write creative, engaging clues that:
1. Don't give away the answer directly
2. Reference both parts of the phrase cleverly  
3. Are appropriate for a general audience
4. Are challenging but fair
5. Use wordplay when possible

Respond with just the clue text, no extra formatting.`,
        
        userPrompt: (answer, style, difficulty) => 
          `Create a ${style} clue for the Before & After puzzle: "${answer}"
          
          Difficulty level: ${difficulty}/3 (1=easy, 2=medium, 3=hard)
          Style: ${style}
          
          Clue:`
      },
      
      anthropic: {
        systemPrompt: `Create engaging clues for "Before & After" word puzzles. These combine two familiar phrases sharing a word.`,
        userPrompt: (answer, style, difficulty) => 
          `Before & After puzzle: "${answer}"
          Style: ${style}, Difficulty: ${difficulty}/3
          Write a clever clue:`
      }
    };
  }

  // Generate multiple clue options for a given answer
  async generateClueOptions(answer, count = 3) {
    const linkingWord = this.findLinkingWord(answer);
    const difficulty = this.calculateDifficulty(answer);
    const parts = this.analyzePhraseparts(answer, linkingWord);
    
    const clueOptions = [];
    
    // Generate using different styles
    for (let i = 0; i < count; i++) {
      const style = this.clueStyles[i % this.clueStyles.length];
      
      try {
        const clue = await this.generateProperFormatClue(parts, style, difficulty);
        if (clue) {
          clueOptions.push({
            clue: clue,
            style: style,
            confidence: this.assessClueQuality(clue, answer),
            linking_word: linkingWord,
            first_part: parts.first,
            second_part: parts.second
          });
        }
      } catch (error) {
        console.error(`Error generating clue with style ${style}:`, error);
      }
    }
    
    // If AI generation fails, fall back to template-based clues
    if (clueOptions.length === 0) {
      clueOptions.push(...this.generateTemplateClues(answer, linkingWord));
    }
    
    // Sort by confidence score
    return clueOptions.sort((a, b) => b.confidence - a.confidence);
  }

  // Generate clue in proper "clue 1 + clue 2" format
  async generateProperFormatClue(parts, style, difficulty) {
    const clue1 = this.generateClueForPhrase(parts.first, style, difficulty);
    const clue2 = this.generateClueForPhrase(parts.second, style, difficulty);
    
    return `${clue1} + ${clue2}`;
  }

  // Generate a clue for a single phrase part
  generateClueForPhrase(phrase, style, difficulty) {
    // Enhanced phrase recognition database
    const phraseClues = {
      // Musicians/Artists
      'BRUNO MARS': "Hawaiian '24k' pop star",
      'OLIVIA NEWTON': "Australian 'Grease' singer",
      'NEIL DIAMOND': "'Sweet Caroline' crooner",
      'LOUIS ARMSTRONG': "Jazz trumpet legend",
      'FRANK SINATRA': "'My Way' singer",
      
      // Movies/TV
      'MARS ATTACKS': "Campy sci-fi invasion movie",
      'E.T. PHONE': "Alien's famous phone request",
      'HOME DEPOT': "Orange-aproned hardware store",
      'FIRE EXTINGUISHER': "Red emergency safety device",
      'DOC HOLLIDAY': "Wild West gunfighter",
      'WIZARD OF OZ': "Ruby slippers classic film",
      
      // Places
      'NEW YORK': "Big Apple metropolis",
      'ST. LOUIS': "Gateway Arch city", 
      'MINNEAPOLIS': "Twin Cities municipality",
      'ST. PAUL': "Minnesota's capital city",
      
      // People
      'MRS. ROBINSON': "Graduate's seductress",
      'ROBINSON CRUSOE': "Shipwrecked literary castaway",
      'JOHN F. KENNEDY': "35th U.S. President",
      'ANTHONY HOPKINS': "Hannibal Lecter actor",
      'DOUGLAS FAIRBANKS': "Silent film swashbuckler",
      
      // Food/Items
      'POTATO HEAD': "Plastic toy with removable parts",
      'HEAD CHEERLEADER': "Squad's top spirit leader",
      'CLEAN SWEEP': "Total victory achievement",
      'MINT JULEP': "Kentucky Derby cocktail",
      'NATURAL GAS': "Cooking fuel source",
      
      // Common endings
      'DEPARTMENT OF THE': "Government agency start",
      'INTERIOR DESIGNERS': "Home decorating professionals",
      'SUPREME COURT': "Highest judicial body",
      'COURT CASE': "Legal proceeding",
      'WHEEL OF FORTUNE': "TV game show",
      'TABLE OF CONTENTS': "Book's chapter listing",
      'TRACK AND FIELD': "Olympic athletics events",
      'ARTS AND CRAFTS': "Creative hobby activities"
    };

    // Check for exact matches first
    for (const [key, clue] of Object.entries(phraseClues)) {
      if (phrase.includes(key)) {
        return clue;
      }
    }

    // Generate clues based on patterns and context
    return this.generateContextualClue(phrase, style, difficulty);
  }

  // Generate contextual clue when no exact match found
  generateContextualClue(phrase, style, difficulty) {
    const words = phrase.split(' ');
    
    // Pattern-based clue generation
    if (phrase.includes('MR.') || phrase.includes('MS.') || phrase.includes('MRS.')) {
      const title = words[0];
      const name = words.slice(1).join(' ');
      return `${title} ${name}`.replace(name, this.getNameHint(name));
    }
    
    if (phrase.includes('PRESIDENT') || phrase.includes('KING') || phrase.includes('QUEEN')) {
      return `Political leader ${this.getNameHint(phrase)}`;
    }
    
    if (phrase.match(/\b(MOVIE|FILM|TV|SHOW)\b/)) {
      return `Entertainment production`;
    }
    
    if (phrase.match(/\b(SONG|ALBUM|MUSIC)\b/)) {
      return `Musical composition`;
    }
    
    if (phrase.match(/\b(BOOK|NOVEL|STORY)\b/)) {
      return `Literary work`;
    }
    
    if (phrase.match(/\b(CITY|TOWN|PLACE)\b/)) {
      return `Geographic location`;
    }
    
    if (phrase.match(/\b(FOOD|DRINK|MEAL)\b/)) {
      return `Culinary item`;
    }
    
    // Generic fallback based on word analysis
    if (words.length <= 2) {
      return `"${phrase}" reference`;
    } else {
      return `Multi-word phrase involving ${words[0].toLowerCase()}`;
    }
  }

  // Get hint for names/proper nouns
  getNameHint(name) {
    const nameHints = {
      'MARS': 'planet',
      'ARMSTRONG': 'astronaut',
      'KENNEDY': 'president', 
      'SINATRA': 'crooner',
      'CRUSOE': 'castaway',
      'HOPKINS': 'actor',
      'ROBINSON': 'character'
    };
    
    for (const [key, hint] of Object.entries(nameHints)) {
      if (name.includes(key)) {
        return hint;
      }
    }
    
    return 'notable figure';
  }

  // Generate a single clue using AI (placeholder - integrate with your preferred AI service)
  async generateSingleClue(answer, style, difficulty) {
    // This is where you'd integrate with OpenAI, Anthropic Claude, or local AI
    // For now, using smart template generation
    
    const templates = this.getStyleTemplates(style, difficulty);
    const template = templates[Math.floor(Math.random() * templates.length)];
    
    return this.fillTemplate(template, answer);
  }

  // Template-based clue generation (fallback and enhancement)
  generateTemplateClues(answer, linkingWord) {
    const parts = this.analyzePhraseparts(answer, linkingWord);
    
    return [
      {
        clue: `${this.generateClueForPhrase(parts.first, 'descriptive', 2)} + ${this.generateClueForPhrase(parts.second, 'descriptive', 2)}`,
        style: 'descriptive',
        confidence: 0.8,
        linking_word: linkingWord,
        first_part: parts.first,
        second_part: parts.second
      },
      {
        clue: `${this.generateClueForPhrase(parts.first, 'cultural_reference', 2)} + ${this.generateClueForPhrase(parts.second, 'cultural_reference', 2)}`,
        style: 'cultural_reference', 
        confidence: 0.7,
        linking_word: linkingWord,
        first_part: parts.first,
        second_part: parts.second
      },
      {
        clue: `${this.generateClueForPhrase(parts.first, 'wordplay', 2)} + ${this.generateClueForPhrase(parts.second, 'wordplay', 2)}`,
        style: 'wordplay',
        confidence: 0.9,
        linking_word: linkingWord,
        first_part: parts.first,
        second_part: parts.second
      }
    ];
  }

  // Analyze the before and after parts
  analyzePhraseparts(answer, linkingWord) {
    const words = answer.split(' ');
    let linkIndex = -1;
    
    // Find where the linking word appears
    for (let i = 0; i < words.length; i++) {
      const cleanWord = words[i].replace(/[^A-Z]/g, '');
      if (cleanWord === linkingWord || cleanWord.includes(linkingWord) || linkingWord.includes(cleanWord)) {
        linkIndex = i;
        break;
      }
    }
    
    // If linking word found, split around it
    if (linkIndex !== -1) {
      const first = words.slice(0, linkIndex + 1).join(' ');
      const second = words.slice(linkIndex).join(' ');
      
      return {
        first: first.trim(),
        second: second.trim(),
        linkingWordPosition: linkIndex
      };
    }
    
    // Fallback: split roughly in the middle
    const midPoint = Math.floor(words.length / 2);
    return {
      first: words.slice(0, midPoint + 1).join(' '),
      second: words.slice(midPoint).join(' '),
      linkingWordPosition: midPoint
    };
  }

  // Get contextual hints for phrase parts
  getHintForPhrase(phrase) {
    // Database of common phrases and their contexts
    const phraseHints = {
      'BRUNO MARS': 'Pop singer',
      'MARS ATTACKS': 'Sci-fi movie',
      'E.T. PHONE': 'Movie quote',
      'HOME DEPOT': 'Hardware store',
      'MR. POTATO': 'Toy brand',
      'HEAD CHEERLEADER': 'School role',
      // Add more as needed
    };
    
    // Check for exact matches
    for (const [key, hint] of Object.entries(phraseHints)) {
      if (phrase.includes(key)) return hint;
    }
    
    // Generate generic hints based on patterns
    if (phrase.includes('MR.') || phrase.includes('MS.') || phrase.includes('MRS.')) {
      return 'Person or character';
    }
    if (phrase.includes('PRESIDENT') || phrase.includes('KING') || phrase.includes('QUEEN')) {
      return 'Political figure';
    }
    if (phrase.match(/\b(MOVIE|FILM|TV|SHOW)\b/)) {
      return 'Entertainment';
    }
    
    return 'Famous phrase';
  }

  // Generate wordplay-based clues
  generateWordplayClue(parts) {
    const templates = [
      `When ${parts.firstHint.toLowerCase()} meets ${parts.secondHint.toLowerCase()}`,
      `${parts.firstHint} followed by ${parts.secondHint.toLowerCase()}`,
      `A combination of ${parts.firstHint.toLowerCase()} and ${parts.secondHint.toLowerCase()}`,
      `${parts.firstHint} transitions to ${parts.secondHint.toLowerCase()}`
    ];
    
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // Get style-specific templates
  getStyleTemplates(style, difficulty) {
    const templates = {
      descriptive: [
        'Two-part phrase combining {hint1} and {hint2}',
        '{hint1} meets {hint2} in this compound expression',
        'A phrase that bridges {hint1} and {hint2}'
      ],
      cryptic: [
        '{hint1} leads to {hint2} in mysterious ways',
        'Where {hint1} and {hint2} become one',
        'The connection between {hint1} and {hint2}'
      ],
      wordplay: [
        '{hint1} transforms into {hint2}',
        'When {hint1} becomes {hint2}',
        '{hint1} evolution to {hint2}'
      ],
      cultural_reference: [
        'Pop culture meets {hint2} via {hint1}',
        '{hint1} in the world of {hint2}',
        'Celebrity crossover: {hint1} and {hint2}'
      ]
    };
    
    return templates[style] || templates.descriptive;
  }

  // Fill template with actual content
  fillTemplate(template, answer) {
    const linkingWord = this.findLinkingWord(answer);
    const parts = this.analyzePhraseparts(answer, linkingWord);
    
    return template
      .replace('{hint1}', parts.firstHint)
      .replace('{hint2}', parts.secondHint)
      .replace('{answer}', answer)
      .replace('{linking}', linkingWord);
  }

  // Assess the quality of a generated clue
  assessClueQuality(clue, answer) {
    let score = 0.5; // Base score
    
    // Positive factors for proper format
    if (clue.includes(' + ')) score += 0.3; // Proper format
    if (clue.split(' + ').length === 2) score += 0.2; // Exactly two parts
    
    // Check clue quality factors
    if (clue.length > 30 && clue.length < 120) score += 0.2; // Good length
    if (!clue.toLowerCase().includes(answer.toLowerCase())) score += 0.2; // Doesn't give away answer
    
    // Negative factors  
    if (clue.includes(answer)) score -= 0.4; // Too obvious
    if (clue.length < 20) score -= 0.2; // Too short
    if (clue.length > 150) score -= 0.2; // Too long
    if (!clue.includes(' + ')) score -= 0.3; // Wrong format
    
    return Math.max(0, Math.min(1, score));
  }

  // Find linking word (reused from previous code)
  findLinkingWord(phrase) {
    const words = phrase.split(' ').filter(word => word.length > 0);
    
    // Look for repeated words
    const wordCounts = {};
    words.forEach(word => {
      const cleanWord = word.replace(/[^A-Z]/g, '');
      if (cleanWord.length > 1) {
        wordCounts[cleanWord] = (wordCounts[cleanWord] || 0) + 1;
      }
    });
    
    const repeatedWords = Object.keys(wordCounts).filter(word => wordCounts[word] > 1);
    if (repeatedWords.length > 0) {
      return repeatedWords.reduce((longest, word) => 
        word.length > longest.length ? word : longest
      );
    }
    
    // Fallback logic
    const significantWords = words.filter(word => {
      const cleanWord = word.replace(/[^A-Z]/g, '');
      return cleanWord.length >= 3;
    });
    
    if (significantWords.length > 0) {
      const middleIndex = Math.floor(significantWords.length / 2);
      return significantWords[middleIndex].replace(/[^A-Z]/g, '');
    }
    
    return words[Math.floor(words.length / 2)].replace(/[^A-Z]/g, '');
  }

  calculateDifficulty(phrase) {
    const words = phrase.split(' ').length;
    const avgWordLength = phrase.replace(/ /g, '').length / words;
    const hasPunctuation = /[&',.-]/.test(phrase);
    
    let difficulty = 1;
    if (words > 5) difficulty++;
    if (avgWordLength > 6) difficulty++;
    if (hasPunctuation) difficulty++;
    
    return Math.min(3, difficulty);
  }
}

// API Routes
const clueGenerator = new AIClueGenerator();

// Generate clues for a specific answer
router.post('/generate-clues', async (req, res) => {
  const { answer, count = 3, style = null } = req.body;
  
  if (!answer) {
    return res.status(400).json({ error: 'Answer is required' });
  }
  
  try {
    const clueOptions = await clueGenerator.generateClueOptions(answer, count);
    
    res.json({
      answer,
      clue_options: clueOptions,
      generated_at: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error generating clues:', error);
    res.status(500).json({ error: 'Failed to generate clues' });
  }
});

// Generate entirely new Before & After phrases
router.post('/generate-phrases', async (req, res) => {
  const { themes = [], count = 5, difficulty = 'mixed' } = req.body;
  
  try {
    const newPhrases = await generateNewPhrases(themes, count, difficulty);
    
    res.json({
      phrases: newPhrases,
      generated_at: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error generating new phrases:', error);
    res.status(500).json({ error: 'Failed to generate new phrases' });
  }
});

// Batch generate clues for existing answers in database
router.post('/batch-generate-clues', async (req, res) => {
  const { limit = 50, overwrite = false } = req.body;
  
  const db = new sqlite3.Database(DB_PATH);
  
  // Get answers that need clues
  const query = overwrite 
    ? `SELECT id, answer, clue FROM clue_library WHERE is_active = 1 LIMIT ?`
    : `SELECT id, answer, clue FROM clue_library WHERE is_active = 1 AND (clue LIKE '%Before & After%' OR clue LIKE '%template%') LIMIT ?`;
  
  db.all(query, [limit], async (err, rows) => {
    if (err) {
      db.close();
      return res.status(500).json({ error: 'Database error' });
    }
    
    let updated = 0;
    let errors = [];
    
    for (const row of rows) {
      try {
        const clueOptions = await clueGenerator.generateClueOptions(row.answer, 1);
        if (clueOptions.length > 0) {
          const bestClue = clueOptions[0];
          
          await new Promise((resolve, reject) => {
            db.run(`
              UPDATE clue_library 
              SET clue = ?, updated_at = datetime('now')
              WHERE id = ?
            `, [bestClue.clue, row.id], (err) => {
              if (err) reject(err);
              else {
                updated++;
                resolve();
              }
            });
          });
        }
      } catch (error) {
        errors.push(`ID ${row.id}: ${error.message}`);
      }
    }
    
    db.close();
    
    res.json({
      processed: rows.length,
      updated,
      errors: errors.slice(0, 10) // Limit error list
    });
  });
});

// Helper function to generate new Before & After phrases
async function generateNewPhrases(themes, count, difficulty) {
  // This would integrate with AI service to create entirely new phrases
  // For now, combinatorial generation from known patterns
  
  const commonWords = {
    people: ['JOHN', 'MARY', 'MICHAEL', 'SARAH', 'DAVID', 'LISA'],
    places: ['NEW YORK', 'PARIS', 'LONDON', 'TOKYO', 'CHICAGO'],
    things: ['PIZZA', 'COFFEE', 'BOOK', 'PHONE', 'CAR', 'HOUSE'],
    actions: ['RUNNING', 'SINGING', 'DANCING', 'COOKING', 'READING']
  };
  
  const linkingWords = ['HOUSE', 'BOOK', 'PHONE', 'PIZZA', 'COFFEE', 'TIME', 'LIGHT', 'HEART'];
  
  const newPhrases = [];
  
  for (let i = 0; i < count; i++) {
    const linkingWord = linkingWords[Math.floor(Math.random() * linkingWords.length)];
    
    // Generate compound phrases (this is simplified - AI would do this better)
    const phrase = await generateCompoundPhrase(linkingWord, themes);
    if (phrase) {
      newPhrases.push({
        answer: phrase,
        linking_word: linkingWord,
        generated: true,
        confidence: 0.7
      });
    }
  }
  
  return newPhrases;
}

async function generateCompoundPhrase(linkingWord, themes) {
  // Simplified phrase generation - in production, use AI
  const patterns = [
    `${linkingWord} OF THE YEAR`,
    `BRAND NEW ${linkingWord}`,
    `${linkingWord} AND SOUL`,
    `MYSTERY ${linkingWord}`,
    `${linkingWord} SWEET ${linkingWord}`
  ];
  
  return patterns[Math.floor(Math.random() * patterns.length)];
}

module.exports = router;
