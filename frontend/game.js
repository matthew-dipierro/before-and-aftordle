// API Configuration
// Auto-detect environment
const API_BASE = (window.location.hostname === 'localhost' || 
                  window.location.protocol === 'file:' ||
                  window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3001/api'  // Local development
    : 'https://before-and-aftordle.onrender.com/api';  // Production

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

// Custom keyboard state
let currentAnswer = '';
let keyboardVisible = false;

// ===== INITIALIZATION =====

function initGame() {
    document.getElementById('introScreen').style.display = 'block';
    document.getElementById('gameScreen').style.display = 'none';
    document.getElementById('resultsScreen').style.display = 'none';
    loadTodaysPuzzle();
    initializeCustomKeyboard();
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
        subtitle.textContent = `Daily word puzzle - ${puzzleClues.length} clues ready!`;
    }
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
    
    // Reset game state
    currentQuestion = 0;
    totalHintsUsed = 0;
    hintPenalties = 0;
    wrongAnswers = 0;
    gameComplete = false;
    questionHints = [];
    wordStates = [];
    structureRevealed = [];
    
    // Initialize arrays for all questions
    for (let i = 0; i < puzzleClues.length; i++) {
        questionHints[i] = 0;
        wordStates[i] = [];
        structureRevealed[i] = false;
    }
    
    startTime = Date.now();
    
    // Hide intro and show game
    document.getElementById('introScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'block';
    
    loadQuestion();
    startTimer();
}

function loadQuestion() {
    if (currentQuestion >= puzzleClues.length) {
        endGame();
        return;
    }
    
    const clue = puzzleClues[currentQuestion];
    
    // Update UI
    document.getElementById('questionNumber').textContent = currentQuestion + 1;
    document.getElementById('clue').textContent = clue.clue;
    document.getElementById('feedback').style.display = 'none';
    document.getElementById('answerInput').value = '';
    
    // Reset answer display
    const display = document.getElementById('answerDisplay');
    display.innerHTML = '<div class="empty-message">Structure will be revealed with hints</div>';
    
    // Reset hint button
    updateHintButton();
    
    // Update progress
    updateProgress();
    
    // Reset custom keyboard
    resetCustomKeyboard();
}

function updateProgress() {
    const progress = ((currentQuestion) / puzzleClues.length) * 100;
    document.getElementById('progressFill').style.width = `${progress}%`;
}

function startTimer() {
    const timerElement = document.getElementById('timer');
    
    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        timerElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
}

function nextQuestion() {
    currentQuestion++;
    setTimeout(() => {
        loadQuestion();
    }, 1500);
}

function endGame() {
    clearInterval(timerInterval);
    gameComplete = true;
    
    const endTime = Date.now();
    const totalTimeSeconds = Math.floor((endTime - startTime) / 1000);
    
    showResults(totalTimeSeconds);
}

// ===== ANSWER VALIDATION =====

async function checkAnswer() {
    const userAnswer = document.getElementById('answerInput').value.trim();
    if (!userAnswer) return;
    
    const clue = puzzleClues[currentQuestion];
    
    try {
        const response = await fetch(`${API_BASE}/puzzles/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                puzzle_id: todaysPuzzle.id,
                clue_id: clue.id,
                user_answer: userAnswer
            })
        });
        
        const result = await response.json();
        
        if (result.correct) {
            showFeedback('Correct! Moving to next clue...', 'correct');
            
            // Show complete answer
            showCompleteAnswer(result.correct_answer, result.linking_word);
            
            if (currentQuestion === puzzleClues.length - 1) {
                setTimeout(endGame, 2000);
            } else {
                nextQuestion();
            }
        } else {
            wrongAnswers++;
            showFeedback('Incorrect. Try again!', 'incorrect');
            document.getElementById('answerInput').value = '';
        }
        
    } catch (error) {
        console.error('Error validating answer:', error);
        showFeedback('Connection error. Please try again.', 'incorrect');
    }
}

function submitAnswer() {
    checkAnswer();
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
    const actionText = hintType === 'first_letter' ? 
        'first letter revealed' : 'fully revealed';
    
    showFeedback(`${isLinking}${actionText} (${penaltyText})`, 'incorrect');
    
    // Update word state
    if (hintType === 'first_letter') {
        wordState.state = 'first_letter';
        wordState.letters[0] = hintData.letter || hintData.word[0];
        
        // Animate the letter reveal
        animateLetterReveal(wordIndex, 0);
        
    } else if (hintType === 'full_word') {
        wordState.state = 'full_word';
        wordState.letters = hintData.word.split('');
        wordState.clickable = false;
        
        // Animate full word reveal
        animateFullWordReveal(wordIndex, hintData.word);
        
        // Check if linking word should be unlocked
        checkLinkingWordUnlock();
    }
    
    console.log('Updated word state:', wordState);
}

function checkLinkingWordUnlock() {
    const currentWordStates = getCurrentWordStates();
    if (!currentWordStates) return;
    
    // Check if all non-linking words are fully revealed
    const nonLinkingWords = currentWordStates.filter(word => !word.is_linking);
    const allNonLinkingRevealed = nonLinkingWords.every(word => word.state === 'full_word');
    
    if (allNonLinkingRevealed) {
        // Unlock linking word
        const linkingWord = currentWordStates.find(word => word.is_linking);
        if (linkingWord && !linkingWord.clickable) {
            linkingWord.clickable = true;
            console.log('Linking word unlocked!');
            
            // Re-render to show the unlocked state
            renderInteractiveWordDisplay(false); // false = don't animate again
        }
    }
}

// ===== API HELPER FUNCTIONS =====

async function getStructureHint() {
    const clue = puzzleClues[currentQuestion];
    
    try {
        const response = await fetch(`${API_BASE}/puzzles/hint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                puzzle_id: todaysPuzzle.id,
                clue_id: clue.id,
                hint_type: 'structure'
            })
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error getting structure hint:', error);
        showFeedback('Connection error. Please try again.', 'incorrect');
        return null;
    }
}

async function getWordHint(wordIndex, hintType) {
    const clue = puzzleClues[currentQuestion];
    
    try {
        const response = await fetch(`${API_BASE}/puzzles/hint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                puzzle_id: todaysPuzzle.id,
                clue_id: clue.id,
                hint_type: hintType,
                word_index: wordIndex
            })
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error getting word hint:', error);
        showFeedback('Connection error. Please try again.', 'incorrect');
        return null;
    }
}

// ===== STATE HELPERS =====

function isStructureRevealed() {
    return structureRevealed[currentQuestion] || false;
}

function getCurrentWordStates() {
    return wordStates[currentQuestion] || null;
}

// ===== DISPLAY FUNCTIONS =====

function renderInteractiveWordDisplay(isFirstRender = true) {
    const display = document.getElementById('answerDisplay');
    const currentWordStates = getCurrentWordStates();
    
    if (!currentWordStates) {
        display.innerHTML = '<div class="empty-message">Use hint to reveal word structure</div>';
        return;
    }
    
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
    
    const instructionText = getInstructionText();
    if (instructionText) {
        html += `<div class="hint-instruction">${instructionText}</div>`;
    }
    
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

function getInstructionText() {
    const currentWordStates = getCurrentWordStates();
    if (!currentWordStates) return '';
    
    const clickableNonLinking = currentWordStates.filter(word => word.clickable && !word.is_linking);
    const linkingWord = currentWordStates.find(word => word.is_linking);
    
    // Check if linking word is fully revealed
    if (linkingWord && linkingWord.state === 'full_word') {
        return 'All hints used!';
    }
    
    if (clickableNonLinking.length > 0) {
        return 'Tap word groups to reveal letters progressively';
    } else if (linkingWord && linkingWord.clickable) {
        return 'The linking word may now be revealed';
    } else {
        return 'All available hints revealed';
    }
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
    
    html += '</div><div class="hint-instruction">Answer complete. Proceeding to next question...</div>';
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
    
    const duration = type === 'correct' ? 3000 : 2000;
    setTimeout(() => {
        feedback.style.display = 'none';
    }, duration);
}

// ===== RESULTS SCREEN =====

function showResults(totalTimeSeconds) {
    document.getElementById('gameScreen').style.display = 'none';
    document.getElementById('resultsScreen').style.display = 'block';
    
    const minutes = Math.floor(totalTimeSeconds / 60);
    const seconds = totalTimeSeconds % 60;
    const timeText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    // Calculate score
    const baseScore = puzzleClues.length * 100;
    const timeBonus = Math.max(0, 300 - totalTimeSeconds);
    const finalScore = baseScore + timeBonus - hintPenalties - (wrongAnswers * 10);
    
    // Update results display
    document.getElementById('finalTime').textContent = timeText;
    document.getElementById('finalScore').textContent = finalScore;
    document.getElementById('hintsUsed').textContent = totalHintsUsed;
    document.getElementById('wrongAnswersCount').textContent = wrongAnswers;
    
    // Performance grid
    showPerformanceGrid();
    
    // Submit results to backend
    submitGameResults(totalTimeSeconds, finalScore);
}

function showPerformanceGrid() {
    const grid = document.getElementById('performanceGrid');
    grid.innerHTML = '';
    
    questionHints.forEach((hints, index) => {
        const dot = document.createElement('div');
        dot.className = 'performance-dot';
        dot.textContent = index + 1;
        
        if (hints === 0) {
            dot.classList.add('perfect');
        } else if (hints <= 2) {
            dot.classList.add('good');
        } else if (hints <= 4) {
            dot.classList.add('struggled');
        } else {
            dot.classList.add('heavy-struggle');
        }
        
        grid.appendChild(dot);
    });
}

async function submitGameResults(totalTimeSeconds, finalScore) {
    try {
        await fetch(`${API_BASE}/puzzles/submit-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                puzzle_id: todaysPuzzle.id,
                completion_time: totalTimeSeconds,
                hints_used: totalHintsUsed,
                score: finalScore,
                wrong_answers: wrongAnswers
            })
        });
        console.log('Game results submitted successfully');
    } catch (error) {
        console.error('Failed to submit game results:', error);
    }
}

function startNewGame() {
    // Reset all game state
    currentQuestion = 0;
    totalHintsUsed = 0;
    hintPenalties = 0;
    wrongAnswers = 0;
    gameComplete = false;
    questionHints = [];
    wordStates = [];
    structureRevealed = [];
    
    // Show loading message and reload puzzle
    const newGameBtn = document.getElementById('newGameBtn');
    newGameBtn.textContent = "Loading new puzzle...";
    newGameBtn.disabled = true;
    newGameBtn.style.background = '#6c757d';
    
    setTimeout(() => {
        newGameBtn.textContent = "Play Tomorrow's Puzzle";
        newGameBtn.disabled = false;
        newGameBtn.style.background = '#667eea';
    }, 3000);
}

// ===== CUSTOM KEYBOARD SYSTEM =====

// Initialize custom keyboard
function initializeCustomKeyboard() {
    // Only on mobile/tablet
    if (window.innerWidth > 768) return;
    
    createKeyboardHTML();
    setupKeyboardEventListeners();
    
    // Show keyboard when input area is tapped
    const answerInput = document.getElementById('answerInput');
    if (answerInput) {
        answerInput.addEventListener('click', showCustomKeyboard);
        answerInput.addEventListener('focus', showCustomKeyboard);
        
        // Prevent system keyboard
        answerInput.setAttribute('readonly', 'true');
        answerInput.setAttribute('inputmode', 'none');
    }
}

function createKeyboardHTML() {
    // Remove existing keyboard if present
    const existingKeyboard = document.querySelector('.custom-keyboard');
    if (existingKeyboard) {
        existingKeyboard.remove();
    }
    
    const keyboardHTML = `
        <div class="custom-keyboard" id="customKeyboard">
            <div class="keyboard-input-display empty" id="keyboardDisplay"></div>
            
            <div class="keyboard-grid">
                <div class="keyboard-row row-1">
                    <div class="key" data-key="Q">Q</div>
                    <div class="key" data-key="W">W</div>
                    <div class="key" data-key="E">E</div>
                    <div class="key" data-key="R">R</div>
                    <div class="key" data-key="T">T</div>
                    <div class="key" data-key="Y">Y</div>
                    <div class="key" data-key="U">U</div>
                    <div class="key" data-key="I">I</div>
                    <div class="key" data-key="O">O</div>
                    <div class="key" data-key="P">P</div>
                </div>
                
                <div class="keyboard-row row-2">
                    <div class="key" data-key="A">A</div>
                    <div class="key" data-key="S">S</div>
                    <div class="key" data-key="D">D</div>
                    <div class="key" data-key="F">F</div>
                    <div class="key" data-key="G">G</div>
                    <div class="key" data-key="H">H</div>
                    <div class="key" data-key="J">J</div>
                    <div class="key" data-key="K">K</div>
                    <div class="key" data-key="L">L</div>
                </div>
                
                <div class="keyboard-row row-3">
                    <div class="key" data-key="Z">Z</div>
                    <div class="key" data-key="X">X</div>
                    <div class="key" data-key="C">C</div>
                    <div class="key" data-key="V">V</div>
                    <div class="key" data-key="B">B</div>
                    <div class="key" data-key="N">N</div>
                    <div class="key" data-key="M">M</div>
                </div>
                
                <div class="keyboard-actions">
                    <div class="key spacebar" data-key=" ">SPACE</div>
                    <div class="key backspace" data-key="BACKSPACE">⌫</div>
                    <div class="key enter" data-key="ENTER" id="enterKey">ENTER</div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', keyboardHTML);
}

function setupKeyboardEventListeners() {
    const keyboard = document.getElementById('customKeyboard');
    if (!keyboard) return;
    
    // Handle key presses
    keyboard.addEventListener('click', handleKeyPress);
    
    // Handle physical keyboard when custom keyboard is visible
    document.addEventListener('keydown', handlePhysicalKeyboard);
    
    // Hide keyboard when clicking outside
    document.addEventListener('click', handleOutsideClick);
}

function handleKeyPress(event) {
    const key = event.target.closest('.key');
    if (!key) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    const keyValue = key.getAttribute('data-key');
    
    // Visual feedback
    key.classList.add('pressed');
    setTimeout(() => key.classList.remove('pressed'), 100);
    
    // Handle the key action
    processKeyInput(keyValue);
}

function handlePhysicalKeyboard(event) {
    if (!keyboardVisible) return;
    
    event.preventDefault();
    
    const key = event.key.toUpperCase();
    
    if (key === 'ENTER') {
        processKeyInput('ENTER');
    } else if (key === 'BACKSPACE') {
        processKeyInput('BACKSPACE');
    } else if (key === ' ') {
        processKeyInput(' ');
    } else if (key === 'ESCAPE') {
        hideCustomKeyboard();
    } else if (/^[A-Z]$/.test(key)) {
        processKeyInput(key);
    }
}

function processKeyInput(keyValue) {
    const display = document.getElementById('keyboardDisplay');
    const answerInput = document.getElementById('answerInput');
    const enterKey = document.getElementById('enterKey');
    
    if (keyValue === 'BACKSPACE') {
        currentAnswer = currentAnswer.slice(0, -1);
    } else if (keyValue === 'ENTER') {
        if (currentAnswer.trim()) {
            handleAnswerSubmission();
            return;
        }
    } else if (keyValue === ' ') {
        // Only add space if there's content and doesn't end with space
        if (currentAnswer && !currentAnswer.endsWith(' ')) {
            currentAnswer += ' ';
        }
    } else if (/^[A-Z]$/.test(keyValue)) {
        // Limit answer length (reasonable limit for phrases)
        if (currentAnswer.length < 50) {
            currentAnswer += keyValue;
        }
    }
    
    // Update display
    updateKeyboardDisplay();
    
    // Update the actual input field
    if (answerInput) {
        answerInput.value = currentAnswer;
    }
    
    // Enable/disable enter button
    if (enterKey) {
        enterKey.disabled = !currentAnswer.trim();
    }
}

function updateKeyboardDisplay() {
    const display = document.getElementById('keyboardDisplay');
    if (!display) return;
    
    if (currentAnswer) {
        display.textContent = currentAnswer;
        display.classList.remove('empty');
    } else {
        display.textContent = '';
        display.classList.add('empty');
    }
}

function handleAnswerSubmission() {
    if (!currentAnswer.trim()) return;
    
    // Hide keyboard first
    hideCustomKeyboard();
    
    // Submit the answer using existing game logic
    const answerInput = document.getElementById('answerInput');
    if (answerInput) {
        answerInput.value = currentAnswer;
        
        // Trigger the existing submit logic
        checkAnswer();
    }
    
    // Clear the current answer
    currentAnswer = '';
    updateKeyboardDisplay();
}

function showCustomKeyboard() {
    if (window.innerWidth > 768) return; // Desktop - use normal keyboard
    
    const keyboard = document.getElementById('customKeyboard');
    if (!keyboard) {
        initializeCustomKeyboard();
        return;
    }
    
    // Set current answer from input field
    const answerInput = document.getElementById('answerInput');
    if (answerInput) {
        currentAnswer = answerInput.value || '';
        updateKeyboardDisplay();
    }
    
    keyboard.classList.add('visible');
    keyboardVisible = true;
    
    // Add body class to adjust layout
    document.body.classList.add('keyboard-open');
    
    // Scroll to keep game visible
    setTimeout(() => {
        const gameContainer = document.querySelector('.game-container');
        if (gameContainer) {
            gameContainer.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'start' 
            });
        }
    }, 300);
}

function hideCustomKeyboard() {
    const keyboard = document.getElementById('customKeyboard');
    if (!keyboard) return;
    
    keyboard.classList.remove('visible');
    keyboardVisible = false;
    
    document.body.classList.remove('keyboard-open');
}

function handleOutsideClick(event) {
    if (!keyboardVisible) return;
    
    const keyboard = document.getElementById('customKeyboard');
    const answerInput = document.getElementById('answerInput');
    
    if (keyboard && 
        !keyboard.contains(event.target) && 
        !answerInput?.contains(event.target)) {
        hideCustomKeyboard();
    }
}

// Clean up current answer when starting new game
function resetCustomKeyboard() {
    currentAnswer = '';
    updateKeyboardDisplay();
    hideCustomKeyboard();
}

// Re-initialize on window resize (orientation change)
window.addEventListener('resize', () => {
    setTimeout(() => {
        if (window.innerWidth <= 768 && !document.getElementById('customKeyboard')) {
            initializeCustomKeyboard();
        } else if (window.innerWidth > 768) {
            hideCustomKeyboard();
            const keyboard = document.getElementById('customKeyboard');
            if (keyboard) keyboard.remove();
        }
    }, 100);
});

// ===== EVENT LISTENERS =====

document.getElementById('answerInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        checkAnswer();
    }
});

// ===== INITIALIZATION =====

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initGame();
});
