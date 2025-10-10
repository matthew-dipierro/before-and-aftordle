// Phrasey Chain - Automated Test Suite - End To End testing using Playwright

import { test, expect } from '@playwright/test';

// Test Configuration
const BASE_URL = 'https://phraseychain.netlify.app/';
const API_BASE_URL = 'https://before-and-aftordle.onrender.com/api';

test.describe('Phrasey Chain - Game Initialization & Puzzle Loading', () => {
  
  test.beforeEach(async ({ page }) => {
    // Navigate to the game before each test
    await page.goto(BASE_URL);
  });

  test('should display the intro screen with game title and instructions', async ({ page }) => {
    // Verify the logo/title is visible
    await expect(page.locator('.logo')).toBeVisible();
    
    // Verify subtitle is visible (text changes after puzzle loads, which is fine)
    const subtitle = page.locator('.subtitle');
    await expect(subtitle).toBeVisible();
    
    // Verify "How to Play" section exists
    await expect(page.locator('.how-to-play')).toBeVisible();
    
    // Verify the Start button is present and enabled
    const startBtn = page.locator('.start-btn');
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toBeEnabled();
    await expect(startBtn).toContainText('Start');
  });

  test('should load today\'s puzzle from the API successfully', async ({ page }) => {
    // Intercept the API call to verify it happens
    const apiResponsePromise = page.waitForResponse(
      response => response.url().includes('/puzzles/today') && response.status() === 200
    );

    // Wait for the page to load and make the API call
    await page.waitForLoadState('networkidle');
    
    // Verify the API call was made
    const apiResponse = await apiResponsePromise;
    const puzzleData = await apiResponse.json();
    
    // Validate the puzzle structure
    expect(puzzleData).toHaveProperty('id');
    expect(puzzleData).toHaveProperty('date');
    expect(puzzleData).toHaveProperty('clues');
    expect(puzzleData.clues).toHaveLength(5);
    
    // Verify each clue has required fields
    puzzleData.clues.forEach((clue, index) => {
      expect(clue).toHaveProperty('clue_number', index + 1);
      expect(clue).toHaveProperty('clue');
      expect(clue.clue).toBeTruthy(); // Clue text should not be empty
    });
    
    console.log('✅ Puzzle loaded successfully:', {
      date: puzzleData.date,
      clueCount: puzzleData.clues.length,
      difficulty: puzzleData.difficulty
    });
  });

  test('should display puzzle number and date on intro screen after loading', async ({ page }) => {
    // Wait for the puzzle to load
    await page.waitForTimeout(1000); // Give time for API response
    
    // Check that the subtitle now includes puzzle number and date
    const subtitle = page.locator('.subtitle');
    const subtitleText = await subtitle.textContent();
    
    // Should contain "No. X" pattern
    expect(subtitleText).toMatch(/No\.\s+\d+/);
    
    // Should contain a date
    expect(subtitleText).toMatch(/\w+,\s+\w+\s+\d+,\s+\d{4}/);
    
    console.log('✅ Intro screen shows:', subtitleText);
  });

  test('should handle API errors gracefully when puzzle fails to load', async ({ page }) => {
    // Mock a failed API response
    await page.route('**/puzzles/today', route => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Server error' })
      });
    });
    
    // Reload the page to trigger the error
    await page.reload();
    await page.waitForTimeout(1000);
    
    // Verify error message is displayed
    const introContent = page.locator('.intro-content');
    await expect(introContent).toContainText('Connection Error');
    
    // Verify retry button appears
    const retryBtn = page.locator('button:has-text("Retry")');
    await expect(retryBtn).toBeVisible();
  });
});

test.describe('Phrasey Chain - Game Start & Word Structure Display', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    // Wait for puzzle to load
    await page.waitForResponse(response => 
      response.url().includes('/puzzles/today') && response.status() === 200
    );
  });

  test('should transition from intro to game screen when Start button clicked', async ({ page }) => {
    // Verify intro screen is visible
    await expect(page.locator('#introScreen')).toBeVisible();
    await expect(page.locator('#gameScreen')).not.toBeVisible();
    
    // Click the start button
    await page.locator('.start-btn').click();
    
    // Verify game screen appears and intro disappears
    await expect(page.locator('#introScreen')).not.toBeVisible();
    await expect(page.locator('#gameScreen')).toBeVisible();
    
    console.log('✅ Successfully transitioned to game screen');
  });

  test('should display first question with clue text and input field', async ({ page }) => {
    // Start the game
    await page.locator('.start-btn').click();
    
    // Verify question number
    const questionNumber = page.locator('#questionNumber');
    await expect(questionNumber).toContainText('Question 1 of 5');
    
    // Verify clue is displayed
    const clue = page.locator('#clue');
    await expect(clue).toBeVisible();
    const clueText = await clue.textContent();
    expect(clueText.length).toBeGreaterThan(10); // Should have actual clue text
    
    // Verify answer input is visible and empty
    const answerInput = page.locator('#answerInput');
    await expect(answerInput).toBeVisible();
    await expect(answerInput).toBeEmpty();
    await expect(answerInput).toBeFocused(); // Should be auto-focused
    
    // Verify timer started
    const timer = page.locator('#timer');
    await expect(timer).toContainText('00:0'); // Timer should have started
    
    console.log('✅ First question displayed correctly');
    console.log('   Clue:', clueText);
  });

  test('should show empty state message before any hints are used', async ({ page }) => {
    // Start the game
    await page.locator('.start-btn').click();
    
    // Verify empty state message
    const answerDisplay = page.locator('#answerDisplay');
    await expect(answerDisplay).toContainText('Type your answer below, or use hints if needed');
    
    // Verify no letter boxes are shown yet
    const letterBoxes = page.locator('.letter-box');
    await expect(letterBoxes).toHaveCount(0);
  });

  test('should display hint button with correct initial text', async ({ page }) => {
    // Start the game
    await page.locator('.start-btn').click();
    
    // Verify hint button
    const hintBtn = page.locator('#hintBtn');
    await expect(hintBtn).toBeVisible();
    await expect(hintBtn).toBeEnabled();
    await expect(hintBtn).toContainText('Show Word Structure');
    
    // Verify button styling (should be primary blue)
    const bgColor = await hintBtn.evaluate(el => 
      window.getComputedStyle(el).backgroundColor
    );
    // Primary blue is rgb(0, 122, 255)
    expect(bgColor).toContain('0, 122, 255');
  });
});

test.describe('Phrasey Chain - Word Structure Hint Display', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForResponse(response => 
      response.url().includes('/puzzles/today') && response.status() === 200
    );
    // Start the game
    await page.locator('.start-btn').click();
  });

  test('should reveal word structure when hint button clicked', async ({ page }) => {
    const hintBtn = page.locator('#hintBtn');
    const answerDisplay = page.locator('#answerDisplay');
    
    // Click the hint button
    await hintBtn.click();
    
    // Wait for API response
    await page.waitForResponse(response => 
      response.url().includes('/puzzles/get-hint') && response.status() === 200
    );
    
    // Wait for animation
    await page.waitForTimeout(1000);
    
    // Verify letter boxes are now displayed
    const letterBoxes = page.locator('.letter-box');
    const boxCount = await letterBoxes.count();
    expect(boxCount).toBeGreaterThan(0);
    
    console.log('✅ Word structure revealed with', boxCount, 'letter boxes');
  });

  test('should display letter boxes with proper structure and styling', async ({ page }) => {
    // Reveal structure
    await page.locator('#hintBtn').click();
    await page.waitForResponse(response => 
      response.url().includes('/puzzles/get-hint')
    );
    await page.waitForTimeout(1000);
    
    // Verify word groups exist
    const wordGroups = page.locator('.word-group');
    const groupCount = await wordGroups.count();
    expect(groupCount).toBeGreaterThan(0);
    
    // Verify letter boxes have correct classes
    const letterBoxes = page.locator('.letter-box');
    const firstBox = letterBoxes.first();
    
    // Check that boxes start as blank
    await expect(firstBox).toHaveClass(/blank/);
    
    // Verify boxes become visible (animation)
    await expect(firstBox).toHaveClass(/visible/);
    
    // Verify structure-revealed styling
    const bgColor = await firstBox.evaluate(el => 
      window.getComputedStyle(el).backgroundColor
    );
    expect(bgColor).toBeTruthy(); // Should have a background color
    
    console.log('✅ Letter boxes have proper structure');
    console.log('   Word groups:', groupCount);
  });

  test('should identify and style linking word differently', async ({ page }) => {
    // Reveal structure
    await page.locator('#hintBtn').click();
    await page.waitForResponse(response => 
      response.url().includes('/puzzles/get-hint')
    );
    await page.waitForTimeout(1000);
    
    // Find linking word group
    const linkingGroup = page.locator('.linking-word-group');
    
    // Verify at least one linking word exists
    const linkingCount = await linkingGroup.count();
    expect(linkingCount).toBeGreaterThan(0);
    
    // Verify linking word boxes have special class
    const linkingBoxes = page.locator('.letter-box.linking-word');
    const linkingBoxCount = await linkingBoxes.count();
    expect(linkingBoxCount).toBeGreaterThan(0);
    
    console.log('✅ Linking word identified and styled');
    console.log('   Linking word letter count:', linkingBoxCount);
  });

  test('should update hint button state after structure revealed', async ({ page }) => {
    const hintBtn = page.locator('#hintBtn');
    
    // Click hint button
    await hintBtn.click();
    await page.waitForResponse(response => 
      response.url().includes('/puzzles/get-hint')
    );
    await page.waitForTimeout(500);
    
    // Verify button is now disabled
    await expect(hintBtn).toBeDisabled();
    
    // Verify button text changed
    await expect(hintBtn).toContainText('Tap words above');
    
    // Verify button styling changed (should be greyed out)
    const bgColor = await hintBtn.evaluate(el => 
      window.getComputedStyle(el).backgroundColor
    );
    // Should no longer be primary blue
    expect(bgColor).not.toContain('0, 122, 255');
    
    console.log('✅ Hint button state updated correctly');
  });

  test('should display feedback message about penalty when hint used', async ({ page }) => {
    // Click hint button
    await page.locator('#hintBtn').click();
    await page.waitForResponse(response => 
      response.url().includes('/puzzles/get-hint')
    );
    
    // Verify feedback message appears
    const feedback = page.locator('#feedback');
    await expect(feedback).toBeVisible();
    
    // Should mention penalty
    await expect(feedback).toContainText('Word structure revealed');
    await expect(feedback).toContainText('-5 points'); // Structure hint penalty
    
    // Should have incorrect/warning styling
    await expect(feedback).toHaveClass(/incorrect/);
    
    console.log('✅ Penalty feedback displayed');
  });

  test('should allow clicking on non-linking words for additional hints', async ({ page }) => {
    // Reveal structure first
    await page.locator('#hintBtn').click();
    await page.waitForResponse(response => 
      response.url().includes('/puzzles/get-hint')
    );
    await page.waitForTimeout(2000); // Increased wait for animation
    
    // Find a clickable word (non-linking) - wait for it to be visible
    const clickableWord = page.locator('.word-group.clickable-word').first();
    await clickableWord.waitFor({ state: 'visible', timeout: 5000 });
    
    // Verify it's clickable
    const isVisible = await clickableWord.isVisible();
    expect(isVisible).toBe(true);
    
// Click the word
    await clickableWord.click();
    
    // Wait for hint API call with longer timeout
    await page.waitForResponse(response => 
      response.url().includes('/puzzles/get-hint') && 
      response.url().includes('word_index'),
      { timeout: 10000 }
    );
    
    // Verify at least one letter was revealed
    await page.waitForTimeout(500);
    const filledBoxes = page.locator('.letter-box.filled');
    const filledCount = await filledBoxes.count();
    expect(filledCount).toBeGreaterThan(0);
    
    console.log('✅ Word click revealed letters');
    console.log('   Filled boxes:', filledCount);
  });

  test('should animate letter boxes when they appear (visual regression check)', async ({ page }) => {
    // Reveal structure
    await page.locator('#hintBtn').click();
    await page.waitForResponse(response => 
      response.url().includes('/puzzles/get-hint')
    );
    
    // Take screenshot immediately after reveal starts
    await page.waitForTimeout(100);
    await expect(page.locator('#answerDisplay')).toHaveScreenshot('word-structure-animating.png', {
      animations: 'allow', // Allow animations to show in screenshot
      maxDiffPixels: 100
    });
    
    // Wait for animation to complete
    await page.waitForTimeout(1000);
    
    // Take screenshot of final state
    await expect(page.locator('#answerDisplay')).toHaveScreenshot('word-structure-complete.png', {
      maxDiffPixels: 100
    });
    
    console.log('✅ Animation screenshots captured');
  });
});

// Additional test for comprehensive game flow
test.describe('Phrasey Chain - Complete Game Flow (Smoke Test)', () => {
  
  test('should complete full game initialization and first hint flow', async ({ page }) => {
    // 1. Load intro screen
    await page.goto(BASE_URL);
    await expect(page.locator('#introScreen')).toBeVisible();
    
    // 2. Wait for puzzle to load
    const apiResponse = await page.waitForResponse(response => 
      response.url().includes('/puzzles/today') && response.status() === 200
    );
    const puzzleData = await apiResponse.json();
    expect(puzzleData.clues).toHaveLength(5);
    
    // 3. Start game
    await page.locator('.start-btn').click();
    await expect(page.locator('#gameScreen')).toBeVisible();
    
    // 4. Verify first question loaded
    await expect(page.locator('#questionNumber')).toContainText('Question 1 of 5');
    const clueText = await page.locator('#clue').textContent();
    expect(clueText.length).toBeGreaterThan(0);
    
    // 5. Reveal word structure
    await page.locator('#hintBtn').click();
    await page.waitForResponse(response => 
      response.url().includes('/puzzles/get-hint')
    );
    await page.waitForTimeout(1000);
    
    // 6. Verify structure displayed correctly
    const letterBoxes = page.locator('.letter-box');
    const boxCount = await letterBoxes.count();
    expect(boxCount).toBeGreaterThan(0);
    
    // 7. Verify hint button disabled
    await expect(page.locator('#hintBtn')).toBeDisabled();
    
    console.log('✅ SMOKE TEST PASSED - Complete flow working');
    console.log('   Puzzle date:', puzzleData.date);
    console.log('   First clue:', clueText);
    console.log('   Letter boxes displayed:', boxCount);
  });
});
