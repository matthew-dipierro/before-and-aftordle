// API Configuration
// Auto-detect environment
const API_BASE = (window.location.hostname === 'localhost' || 
                  window.location.protocol === 'file:' ||
                  window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3001/api'  // Local development
    : '/api';  // Production

console.log('Current hostname:', window.location.hostname);
console.log('Using API_BASE:', API_BASE);

// Game state
let currentQuestion = 0;
let startTime;
let questionHints = [];
let gameComplete = false;
let totalHintsUsed = 0;
let wrongAnswers = 0;
let hintPenalties = 0;
let timerInterval;

// Today's puzzle data (loaded from API)
let todaysPuzzle = null;
let puzzleClues = [];

// Global state for tracking word hints per question
let wordStates = []; // Array of arrays - one per question
let structureRevealed = []; // Track if structure is revealed per question

// ===== INITIALIZATION =====

function initGame() {
    document.getElementById('introScreen').style.display = 'block';
    document.getElementById('gameScreen').style.display = 'none';
    document.getElementById('resultsScreen').style.display = 'none';
    loadTodaysPuzzle();
}

async function loadTodaysPuzzle() {
    try {
        const response = await fetch(`${API_BASE}/puzzles/today`);
        const data = await response.json();
        
        if (data.error) {
            showError(`No puzzle available: ${data.error}`);
            return;
        }
        
        todaysPuzzle = data;
        puzzleClues = data.clues;
        updateIntroScreen();
        
    } catch (error) {
        console.error('Failed to load today\'s puzzle:', error);
        showError('Failed to connect to the puzzle server. Please check if the backend is running on port 3001.');
    }
}

function updateIntroScreen() {
    const subtitle = document.querySelector('.subtitle');
    if (todaysPuzzle) {
        const puzzleNumber = getPuzzleNumber(todaysPuzzle.date);
        const formattedDate = formatDate(todaysPuzzle.date);
        subtitle.innerHTML = `No. ${puzzleNumber} - ${formattedDate}<br><span class="byline">by Matthew DiPierro</span>`;
    }
}

function getPuzzleNumber(dateString) {
    // Calculate puzzle number based on days since game launch
    // Using September 10, 2025 as day 1 for example
    const launchDate = new Date('2025-09-10');
    const puzzleDate = new Date(dateString);
    const daysDiff = Math.floor((puzzleDate - launchDate) / (1000 * 60 * 60 * 24)) + 1;
    return Math.max(1, daysDiff);
}

function formatDate(dateString) {
    // Parse the date string and ensure it's interpreted as local time
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day); // month is 0-indexed in JS
    
    return date.toLocaleDateString('en-US', { 
        weekday: 'long',
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
}

function showError(message) {
    const introContent = document.querySelector('.intro-content');
    introContent.innerHTML = `
        <h2 style="color: #dc3545;">Connection Error</h2>
        <div style="background: #f8d7da; color: #721c24; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Error:</strong> ${message}</p>
            <p style="margin-top: 10px;">Make sure your backend server is running:</p>
            <code style="background: #fff; padding: 5px; border-radius: 3px; display: block; margin: 10px 0;">cd backend && npm run dev</code>
        </div>
        <button class="start-btn" onclick="loadTodaysPuzzle()" style="background: #6c757d;">🔄 Retry Connection</button>
    `;
}

// ===== GAME FLOW =====

function startGame() {
    if (!todaysPuzzle || !puzzleClues.length) {
        alert('No puzzle loaded! Please wait for the puzzle to load or check your connection.');
        return;
    }
    
    document.getElementById('introScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'block';
    
    // Reset game state
    currentQuestion = 0;
    startTime = Date.now();
    questionHints = new Array(puzzleClues.length).fill(0);
    gameComplete = false;
    totalHintsUsed = 0;
    wrongAnswers = 0;
    hintPenalties = 0;
    wordStates = [];
    structureRevealed = [];
    
    loadQuestion();
    startTimer();
}

function loadQuestion() {
    if (currentQuestion >= puzzleClues.length) {
        showResults();
        return;
    }

    const clue = puzzleClues[currentQuestion];
    
    document.getElementById('questionNumber').textContent = `Question ${currentQuestion + 1} of ${puzzleClues.length}`;
    document.getElementById('clue').textContent = clue.clue;
    document.getElementById('answerInput').value = '';
    document.getElementById('answerInput').focus();
    document.getElementById('feedback').style.display = 'none';
    
    updateProgress();
    updateDisplay();
    updateHintButton();
}

function updateDisplay() {
    if (isStructureRevealed()) {
        renderInteractiveWordDisplay();
    } else {
        showEmptyState();
    }
}

function showEmptyState() {
    const display = document.getElementById('answerDisplay');
    display.innerHTML = '<div class="empty-message">Type your answer below, or use hints if needed</div>';
}

// ===== API CALLS =====

async function getStructureHint() {
    try {
        const response = await fetch(`${API_BASE}/puzzles/get-hint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clue_number: currentQuestion + 1 })
        });
        
        const hintData = await response.json();
        if (hintData.error) {
            showFeedback(`Hint error: ${hintData.error}`, 'incorrect');
            return null;
        }
        return hintData;
    } catch (error) {
        console.error('Error getting structure hint:', error);
        showFeedback('Failed to get hint. Try again.', 'incorrect');
        return null;
    }
}

async function getWordHint(wordIndex, hintType) {
    try {
        const response = await fetch(`${API_BASE}/puzzles/get-hint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clue_number: currentQuestion + 1,
                word_index: wordIndex,
                hint_type: hintType
            })
        });
        
        const hintData = await response.json();
        if (hintData.error) {
            showFeedback(`Hint error: ${hintData.error}`, 'incorrect');
            return null;
        }
        return hintData;
    } catch (error) {
        console.error('Error getting word hint:', error);
        showFeedback('Failed to get hint. Try again.', 'incorrect');
        return null;
    }
}

async function checkAnswer() {
    const userAnswer = document.getElementById('answerInput').value.toUpperCase().trim();
    
    if (!userAnswer) {
        showFeedback('Please enter an answer!', 'incorrect');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/puzzles/validate-clue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clue_number: currentQuestion + 1,
                answer: userAnswer
            })
        });
        
        const result = await response.json();
        
        if (result.error) {
            showFeedback(`Error: ${result.error}`, 'incorrect');
            return;
        }
        
        if (result.correct) {
            showFeedback(`Correct! Answer: ${result.full_answer}`, 'correct');
            
            if (result.full_answer) {
                if (isStructureRevealed()) {
                    // Complete any remaining letters in the existing structure
                    setTimeout(() => revealCompleteAnswer(result.full_answer), 500);
                } else {
                    // Show complete answer celebration for solving without hints
                    setTimeout(() => showCelebrationAnswer(result.full_answer, result.linking_word), 500);
                }
            }
            
            setTimeout(() => {
                currentQuestion++;
                loadQuestion();
            }, 2500);
        } else {
            wrongAnswers++;
            showFeedback('Try again!', 'incorrect');
            document.getElementById('answerInput').value = '';
        }
        
    } catch (error) {
        console.error('Error validating answer:', error);
        showFeedback('Connection error. Please try again.', 'incorrect');
    }
}

// ===== HINT SYSTEM =====

async function giveHint() {
    console.log('Getting structure hint...');
    const hintData = await getStructureHint();
    if (!hintData) return;
    
    console.log('Structure hint data:', hintData);
    
    hintPenalties += hintData.penalty;
    totalHintsUsed++;
    
    showFeedback(`Word structure revealed (-${hintData.penalty} points)`, 'incorrect');
    initializeWordStates(hintData.word_structure);
    updateHintButton();
}

function initializeWordStates(wordStructure) {
    console.log('Initializing word states with:', wordStructure);
    
    // Ensure arrays exist for current question
    while (wordStates.length <= currentQuestion) {
        wordStates.push([]);
        structureRevealed.push(false);
    }
    
    // Initialize word states for current question
    wordStates[currentQuestion] = wordStructure.map(wordData => {
        // Make sure non-linking words start as clickable
        const clickable = !wordData.is_linking;
        
        return {
            word_index: wordData.word_index,
            length: wordData.length,
            is_linking: wordData.is_linking,
            state: 'empty',
            letters: new Array(wordData.length).fill('_'),
            clickable: clickable  // Non-linking words should be clickable initially
        };
    });
    
    structureRevealed[currentQuestion] = true;
    
    console.log('Final word states:', wordStates[currentQuestion]);
    
    renderInteractiveWordDisplay();
}

async function handleWordClick(wordIndex) {
    const currentWordStates = getCurrentWordStates();
    const wordState = currentWordStates[wordIndex];
    
    console.log('Word clicked:', wordIndex, 'State:', wordState);
    
    // Visual feedback
    const wordElement = document.querySelector(`[data-word-index="${wordIndex}"]`);
    if (wordElement) {
        wordElement.style.transform = 'scale(0.98)';
        setTimeout(() => wordElement.style.transform = '', 150);
    }
    
    if (!wordState.clickable) {
        const message = wordState.is_linking ? 
            'Complete other words first to unlock the linking word' : 
            'This word is not available for hints';
        showFeedback(message, 'incorrect');
        console.log('Word not clickable:', message);
        return;
    }
    
    // Determine hint type
    let hintType;
    if (wordState.state === 'empty') {
        hintType = 'first_letter';
    } else if (wordState.state === 'first_letter') {
        hintType = 'full_word';
    } else {
        console.log('Word already fully revealed');
        return; // Already fully revealed
    }
    
    console.log('Requesting hint:', hintType, 'for word', wordIndex);
    
    const hintData = await getWordHint(wordIndex, hintType);
    if (!hintData) return;
    
    hintPenalties += hintData.penalty;
    totalHintsUsed++;
    
    // Show feedback
    const penaltyText = `-${hintData.penalty} points`;
    const isLinking = wordState.is_linking ? 'Linking word ' : '';
    const actionText = hintType === 'first_letter' ? 'first letter revealed' : 'fully revealed';
    showFeedback(`${isLinking}${actionText} (${penaltyText})`, 'incorrect');
    
    // Update state and animate (no re-render)
    updateWordState(wordIndex, hintData);
    
    checkLinkingWordAvailability();
}

function updateWordState(wordIndex, hintData) {
    const currentWordStates = getCurrentWordStates();
    const wordState = currentWordStates[wordIndex];
    const revealedWord = hintData.revealed_word;
    
    if (hintData.hint_type === 'first_letter') {
        wordState.state = 'first_letter';
        wordState.letters[0] = revealedWord.word[0];
        wordState.clickable = true;
        
        // Animate single letter reveal
        setTimeout(() => animateLetterReveal(wordIndex, 0), 100);
        
    } else if (hintData.hint_type === 'full_word') {
        wordState.state = 'full_word';
        wordState.letters = revealedWord.word.split('');
        wordState.clickable = false;
        
        // Animate full word reveal with stagger
        setTimeout(() => animateFullWordReveal(wordIndex, revealedWord.word), 100);
    }
}

function checkLinkingWordAvailability() {
    const currentWordStates = getCurrentWordStates();
    const linkingWordIndex = currentWordStates.findIndex(word => word.is_linking);
    if (linkingWordIndex === -1) return;
    
    const nonLinkingWords = currentWordStates.filter(word => !word.is_linking);
    const allNonLinkingRevealed = nonLinkingWords.every(word => word.state === 'full_word');
    
    const wasClickable = currentWordStates[linkingWordIndex].clickable;
    currentWordStates[linkingWordIndex].clickable = allNonLinkingRevealed;
    
    if (allNonLinkingRevealed && !wasClickable && currentWordStates[linkingWordIndex].state !== 'full_word') {
        setTimeout(() => showFeedback('The linking word may now be revealed', 'correct'), 500);
    }
}

// ===== DISPLAY FUNCTIONS =====

function renderInteractiveWordDisplay() {
    const display = document.getElementById('answerDisplay');
    const currentWordStates = getCurrentWordStates();
    
    if (!currentWordStates) {
        showEmptyState();
        return;
    }
    
    // Check if this is the first render (structure reveal) or a re-render (after hint)
    const isFirstRender = !display.querySelector('.letter-box');
    
    let html = '<div class="letter-boxes">';
    
    currentWordStates.forEach((wordData) => {
        const classes = [
            'word-group',
            wordData.clickable ? 'clickable-word' : '',
            wordData.is_linking ? 'linking-word-group' : ''
        ].filter(Boolean).join(' ');
        
        html += `<div class="${classes}" 
                      data-word-index="${wordData.word_index}" 
                      onclick="handleWordClick(${wordData.word_index})"
                      style="cursor: ${wordData.clickable ? 'pointer' : 'default'}">`;
        
        wordData.letters.forEach((letter) => {
            const letterClasses = [
                'letter-box',
                letter === '_' ? 'blank' : 'filled',
                wordData.is_linking ? 'linking-word' : '',
                // If it's a re-render, immediately mark boxes as visible
                !isFirstRender ? 'visible' : ''
            ].filter(Boolean).join(' ');
            
            html += `<div class="${letterClasses}">${letter === '_' ? '' : letter}</div>`;
        });
        
        html += '</div>';
    });
    
    html += '</div>';
    
    display.innerHTML = html;
    
    // Only animate boxes on first render (structure reveal)
    if (isFirstRender) {
        setTimeout(() => {
            animateBoxMaterialization();
        }, 10);
    }
    
    // Debug logging
    console.log('Rendered word states:', currentWordStates.map(w => ({
        index: w.word_index,
        clickable: w.clickable,
        state: w.state,
        is_linking: w.is_linking
    })));
}

function revealCompleteAnswer(fullAnswer) {
    const currentWordStates = getCurrentWordStates();
    const words = fullAnswer.split(' ');
    
    // Reveal words sequentially
    words.forEach((word, wordIndex) => {
        const wordState = currentWordStates[wordIndex];
        if (!word || !wordState) return;
        
        // Calculate delay for this word (previous words complete first)
        const wordDelay = wordIndex * 300; // 300ms between word starts
        
        setTimeout(() => {
            // Reveal any remaining blank letters in this word
            for (let letterIndex = 0; letterIndex < word.length; letterIndex++) {
                if (wordState.letters[letterIndex] === '_') {
                    wordState.letters[letterIndex] = word[letterIndex];
                    // Animate with stagger within the word
                    setTimeout(() => {
                        animateLetterReveal(wordIndex, letterIndex);
                    }, letterIndex * 60); // 60ms stagger between letters in same word
                }
            }
            wordState.state = 'complete';
            wordState.clickable = false;
        }, wordDelay);
    });
}

function showCelebrationAnswer(fullAnswer, linkingWord) {
    const display = document.getElementById('answerDisplay');
    const words = fullAnswer.split(' ');
    const linkIndex = words.findIndex(word => word === linkingWord);
    
    let html = '<div class="letter-boxes celebration-reveal">';
    
    words.forEach((word, wordIndex) => {
        const isLinking = wordIndex === linkIndex;
        const groupClass = isLinking ? 'word-group linking-word-group celebration' : 'word-group celebration';
        
        html += `<div class="${groupClass}">`;
        
        for (let letterIndex = 0; letterIndex < word.length; letterIndex++) {
            const letterClass = isLinking ? 'letter-box filled linking-word celebration-letter' : 'letter-box filled celebration-letter';
            // Calculate delay: word starts at wordIndex * 300ms, letters within word at 60ms intervals
            const animationDelay = (wordIndex * 300) + (letterIndex * 60);
            html += `<div class="${letterClass}" style="animation-delay: ${animationDelay}ms">${word[letterIndex]}</div>`;
        }
        
        html += '</div>';
    });
    
    html += '</div>';
    display.innerHTML = html;
}

function showCompleteAnswer(answer, linkingWord) {
    const display = document.getElementById('answerDisplay');
    const words = answer.split(' ');
    const linkIndex = words.findIndex(word => word === linkingWord);
    
    let html = '<div class="letter-boxes">';
    
    words.forEach((word, wordIndex) => {
        const isLinking = wordIndex === linkIndex;
        html += `<div class="word-group${isLinking ? ' linking-word-group' : ''}">`;
        
        for (let i = 0; i < word.length; i++) {
            html += `<div class="letter-box filled${isLinking ? ' linking-word' : ''}">${word[i]}</div>`;
        }
        
        html += '</div>';
    });
    
    html += '</div>';
    display.innerHTML = html;
}

// ===== ANIMATION SYSTEM - SIMPLE & RELIABLE =====

function animateBoxMaterialization() {
    // Find all boxes that need to materialize (aren't already visible)
    const boxes = document.querySelectorAll('.letter-box:not(.visible)');
    
    // Simple stagger - each box animates in after a small delay
    boxes.forEach((box, index) => {
        setTimeout(() => {
            box.classList.add('visible');
        }, index * 60); // 60ms stagger
    });
}

function animateLetterReveal(wordIndex, letterIndex) {
    const wordElement = document.querySelector(`[data-word-index="${wordIndex}"]`);
    if (!wordElement) return;
    
    const letterBox = wordElement.children[letterIndex];
    if (!letterBox) return;
    
    // Get the letter we're revealing
    const currentWordStates = getCurrentWordStates();
    const letter = currentWordStates[wordIndex].letters[letterIndex];
    
    // Simple reveal: just add the letter and trigger animation
    letterBox.textContent = letter;
    letterBox.classList.remove('blank');
    letterBox.classList.add('filled', 'revealing');
    
    // Clean up animation class after it completes
    setTimeout(() => {
        letterBox.classList.remove('revealing');
    }, 400);
}

function animateFullWordReveal(wordIndex, word) {
    const wordElement = document.querySelector(`[data-word-index="${wordIndex}"]`);
    if (!wordElement) return;
    
    // Reveal each letter with a slight stagger
    for (let i = 0; i < word.length; i++) {
        setTimeout(() => {
            const letterBox = wordElement.children[i];
            if (!letterBox) return;
            
            letterBox.textContent = word[i];
            letterBox.classList.remove('blank');
            letterBox.classList.add('filled', 'revealing');
            
            // Clean up
            setTimeout(() => {
                letterBox.classList.remove('revealing');
            }, 400);
        }, i * 40); // 40ms stagger between letters
    }
}

// ===== UI HELPERS =====

function updateHintButton() {
    const hintBtn = document.getElementById('hintBtn');
    
    if (isStructureRevealed()) {
        hintBtn.disabled = true;
        hintBtn.textContent = 'Tap words above to reveal letters';
        hintBtn.style.background = 'var(--bg-tertiary)';
        hintBtn.style.color = 'var(--text-secondary)';
    } else {
        hintBtn.disabled = false;
        hintBtn.textContent = 'Show Word Structure';
        hintBtn.style.background = 'var(--primary-blue)';
        hintBtn.style.color = 'white';
    }
}

function showFeedback(message, type) {
    const feedback = document.getElementById('feedback');
    feedback.classList.remove('correct', 'incorrect');
    feedback.textContent = message;
    feedback.classList.add(type);
    feedback.style.display = 'block';
    
    const duration = type === 'correct' ? 3000 : 4000;
    setTimeout(() => {
        if (feedback.textContent === message) {
            feedback.style.display = 'none';
        }
    }, duration);
}

function updateProgress() {
    const segments = document.querySelectorAll('.segment');
    
    segments.forEach((segment, index) => {
        segment.classList.remove('completed', 'current');
        
        if (index < currentQuestion) {
            // Questions already completed
            segment.classList.add('completed');
        } else if (index === currentQuestion) {
            // Current question
            segment.classList.add('current');
        }
        // Remaining segments stay grey (no class)
    });
}

function startTimer() {
    timerInterval = setInterval(() => {
        if (!gameComplete) {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            document.getElementById('timer').textContent = 
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }, 1000);
}

// ===== UTILITY FUNCTIONS =====

function getCurrentWordStates() {
    return wordStates[currentQuestion] || null;
}

function isStructureRevealed() {
    return structureRevealed[currentQuestion] || false;
}

function getQuestionHintSummary() {
    const currentWordStates = getCurrentWordStates();
    if (!currentWordStates) return { hintsUsed: 0, totalPenalty: 0 };
    
    let hintsUsed = 0;
    let totalPenalty = 0;
    
    if (isStructureRevealed()) {
        hintsUsed++;
        totalPenalty += 5;
    }
    
    currentWordStates.forEach(word => {
        if (word.state === 'first_letter') {
            hintsUsed++;
            totalPenalty += word.is_linking ? 5 : 3;
        } else if (word.state === 'full_word') {
            hintsUsed += 2;
            totalPenalty += word.is_linking ? 10 : 6;
        }
    });
    
    return { hintsUsed, totalPenalty };
}

// ===== RESULTS =====

async function showResults() {
    gameComplete = true;
    clearInterval(timerInterval);
    
    const totalTime = Math.floor((Date.now() - startTime) / 1000);
    const wrongAnswerPenalty = wrongAnswers * 2;
    const totalPenalties = wrongAnswerPenalty + hintPenalties;
    const finalScore = Math.max(0, 100 - totalPenalties);
    
    // Generate performance grid
    const grid = document.getElementById('performanceGrid');
    grid.innerHTML = '';
    
    for (let i = 0; i < puzzleClues.length; i++) {
        const dot = document.createElement('div');
        dot.className = 'performance-dot';
        
        const originalQuestion = currentQuestion;
        currentQuestion = i;
        const summary = getQuestionHintSummary();
        currentQuestion = originalQuestion;
        
        if (summary.hintsUsed === 0) {
            dot.classList.add('perfect');
        } else if (summary.hintsUsed <= 2) {
            dot.classList.add('good');
        } else if (summary.hintsUsed <= 5) {
            dot.classList.add('struggled');
        } else {
            dot.classList.add('heavy-struggle');
        }
        
        dot.textContent = '✓';
        dot.title = `Question ${i+1}: ${summary.hintsUsed} hints used (-${summary.totalPenalty} points)`;
        grid.appendChild(dot);
    }
    
    // Display results
    const minutes = Math.floor(totalTime / 60);
    const seconds = totalTime % 60;
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    document.getElementById('finalScore').textContent = `${finalScore}/100`;
    document.getElementById('completionTime').textContent = timeStr;
    document.getElementById('wrongAnswerPenalty').textContent = wrongAnswerPenalty;
    document.getElementById('hintPenalty').textContent = hintPenalties;
    document.getElementById('totalPenalties').textContent = totalPenalties;
    
    await submitResults(finalScore, totalTime);
    updateStats(finalScore);
    
    document.getElementById('gameScreen').style.display = 'none';
    document.getElementById('resultsScreen').style.display = 'block';
}

async function submitResults(score, completionTime) {
    try {
        const clueResults = questionHints.map((hints, index) => ({
            clue_number: index + 1,
            hints_used: hints
        }));
        
        const response = await fetch(`${API_BASE}/puzzles/submit-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                score, completionTime, hintsUsed: totalHintsUsed, wrongAnswers,
                hintBreakdown: { total: hintPenalties, per_clue: questionHints },
                clueResults
            })
        });
        
        const result = await response.json();
        if (result.success) {
            console.log('Results submitted successfully:', result);
        }
    } catch (error) {
        console.error('Error submitting results:', error);
    }
}

function updateStats(score) {
    let stats = {};
    try {
        stats = JSON.parse(localStorage.getItem('beforeAndAftordleStats') || '{}');
    } catch (e) {
        stats = { gamesPlayed: 0, currentStreak: 0, bestScore: 0 };
    }
    
    stats.gamesPlayed = (stats.gamesPlayed || 0) + 1;
    stats.currentStreak = (stats.currentStreak || 0) + 1;
    
    if (!stats.bestScore || score > stats.bestScore) {
        stats.bestScore = score;
    }
    
    try {
        localStorage.setItem('beforeAndAftordleStats', JSON.stringify(stats));
    } catch (e) {
        // localStorage not available
    }
    
    document.getElementById('gamesPlayed').textContent = stats.gamesPlayed;
    document.getElementById('currentStreak').textContent = stats.currentStreak;
    document.getElementById('bestScore').textContent = `${stats.bestScore}/100`;
}

function startNewGame() {
    clearInterval(timerInterval);
    
    const newGameBtn = document.querySelector('.new-game-btn');
    newGameBtn.textContent = "Tomorrow's Puzzle Coming Soon!";
    newGameBtn.disabled = true;
    newGameBtn.style.background = '#6c757d';
    
    setTimeout(() => {
        newGameBtn.textContent = "Play Tomorrow's Puzzle";
        newGameBtn.disabled = false;
        newGameBtn.style.background = '#667eea';
    }, 3000);
}

// ===== EVENT LISTENERS =====

document.getElementById('answerInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        checkAnswer();
    }
});

// ===== INITIALIZATION =====

initGame();
