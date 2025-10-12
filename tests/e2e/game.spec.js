// Phrasey Chain automated tests using Playwright

import { test, expect } from '@playwright/test';

// Test config
const BASE_URL = 'https://phraseychain.netlify.app/';
const API_BASE_URL = 'https://before-and-aftordle.onrender.com/api';

test.describe('Phrasey Chain - Game Initialization & Puzzle Loading', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('should display the intro screen with game title and instructions', async ({ page }) => {
    // Locate the elements we want to verify
    const logo = page.locator('.logo');
    const subtitle = page.locator('.subtitle');
    const howToPlay = page.locator('.how-to-play');
    const startBtn = page.locator('.start-btn');
    
    // Page already loaded in beforeEach
    
    // Verify all intro screen elements are visible and correct
    await expect(logo).toBeVisible();
    await expect(subtitle).toBeVisible();
    await expect(howToPlay).toBeVisible();
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toBeEnabled();
    await expect(startBtn).toContainText('Start');
  });

  test('should load today\'s puzzle from the API successfully', async ({ page }) => {
    // Set up API response listener then wait for the API call with a timeout
    const apiResponse = await page.waitForResponse(
      response => response.url().includes('/puzzles/today') && response.status() === 200,
      { timeout: 10000 }
    );
    
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
      expect(clue.clue).toBeTruthy();
    });
    
    console.log('✅ Puzzle loaded successfully:', {
      date: puzzleData.date,
      clueCount: puzzleData.clues.length,
      difficulty: puzzleData.difficulty
    });
  });

  test('should display puzzle number and date on intro screen after loading', async ({ page }) => {
    await page.waitForTimeout(1000);
    
    const subtitle = page.locator('.subtitle');
    const subtitleText = await subtitle.textContent();
    
    // Should contain "No. X" pattern
    expect(subtitleText).toMatch(/No\.\s+\d+/);
    
    // Should contain a date
    expect(subtitleText).toMatch(/\w+,\s+\w+\s+\d+,\s+\d{4}/);
    
    console.log('✅ Intro screen shows:', subtitleText);
  });

  test('should handle API errors gracefully when puzzle fails to load', async ({ page }) => {
    await page.route('**/puzzles/today', route => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Server error' })
      });
    });
    
    await page.reload();
    await page.waitForTimeout(1000);
    
    const introContent = page.locator('.intro-content');
    await expect(introContent).toContainText('Connection Error');
    
    const retryBtn = page.locator('button:has-text("Retry")');
    await expect(retryBtn).toBeVisible();
  });
});

test.describe('Phrasey Chain - Game Start & Word Structure Display', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForResponse(
      response => response.url().includes('/puzzles/today') && response.status() === 200,
      { timeout: 10000 }
    );
  });

  test('should transition from intro to game screen when Start button clicked', async ({ page }) => {
    // Locate screens and verify initial state
    const introScreen = page.locator('#introScreen');
    const gameScreen = page.locator('#gameScreen');
    await expect(introScreen).toBeVisible();
    await expect(gameScreen).not.toBeVisible();
    
    // Click the start button
    await page.locator('.start-btn').click();
    
    // Verify screen transition occurred
    await expect(introScreen).not.toBeVisible();
    await expect(gameScreen).toBeVisible();
    
    console.log('✅ Successfully transitioned to game screen');
  });

  test('should display first question with clue text and input field', async ({ page }) => {
    // Start the game by clicking start button
    await page.locator('.start-btn').click();
    
    // Game loads first question automatically
    
    // Verify all question elements are present and correct
    const questionNumber = page.locator('#questionNumber');
    await expect(questionNumber).toContainText('Question 1 of 5');
    
    const clue = page.locator('#clue');
    await expect(clue).toBeVisible();
    const clueText = await clue.textContent();
    expect(clueText.length).toBeGreaterThan(10);
    
    const answerInput = page.locator('#answerInput');
    await expect(answerInput).toBeVisible();
    await expect(answerInput).toBeEmpty();
    await expect(answerInput).toBeFocused();
    
    const timer = page.locator('#timer');
    await expect(timer).toContainText('00:0');
    
    console.log('✅ First question displayed correctly');
    console.log('   Clue:', clueText);
  });

  test('should show empty state message before any hints are used', async ({ page }) => {
    await page.locator('.start-btn').click();
    
    const answerDisplay = page.locator('#answerDisplay');
    await expect(answerDisplay).toContainText('Type your answer below, or use hints if needed');
    
    const letterBoxes = page.locator('.letter-box');
    await expect(letterBoxes).toHaveCount(0);
  });

  test('should display hint button with correct initial text', async ({ page }) => {
    await page.locator('.start-btn').click();
    
    const hintBtn = page.locator('#hintBtn');
    await expect(hintBtn).toBeVisible();
    await expect(hintBtn).toBeEnabled();
    await expect(hintBtn).toContainText('Show Word Structure');
    
    const bgColor = await hintBtn.evaluate(el => 
      window.getComputedStyle(el).backgroundColor
    );
    expect(bgColor).toContain('0, 122, 255');
  });
});

test.describe('Phrasey Chain - Word Structure Hint Display', () => {
  
  test.beforeEach(async ({ page }) => {
    // Set up listener before navigation to catch the API call
    const responsePromise = page.waitForResponse(
      response => response.url().includes('/puzzles/today') && response.status() === 200,
      { timeout: 15000 }
    );
    
    await page.goto(BASE_URL);
    await responsePromise; // Now wait for it
    
    await page.waitForTimeout(500); // Small buffer for UI to settle
    await page.locator('.start-btn').click();
  });

  test('should reveal word structure when hint button clicked', async ({ page }) => {
    // Locate the hint button
    const hintBtn = page.locator('#hintBtn');
    
    // Click the hint button
    await hintBtn.click();
    
    // Wait for API to respond
    await page.waitForResponse(
      response => response.url().includes('/puzzles/get-hint') && response.status() === 200,
      { timeout: 10000 }
    );
    
    // Wait for animation to complete
    await page.waitForTimeout(1000);
    
    // Verify letter boxes appeared
    const letterBoxes = page.locator('.letter-box');
    const boxCount = await letterBoxes.count();
    expect(boxCount).toBeGreaterThan(0); // At least 1 box should exist
    
    console.log('✅ Word structure revealed with', boxCount, 'letter boxes');
  });

  test('should display letter boxes with proper structure and styling', async ({ page }) => {
    // Reveal the word structure
    await page.locator('#hintBtn').click();
    await page.waitForResponse(
      response => response.url().includes('/puzzles/get-hint'),
      { timeout: 10000 }
    );
    await page.waitForTimeout(1000);
    
    // Verify word groups exist
    const wordGroups = page.locator('.word-group');
    const groupCount = await wordGroups.count();
    expect(groupCount).toBeGreaterThan(0);
    
    // Verify letter boxes have correct styling
    const letterBoxes = page.locator('.letter-box');
    const firstBox = letterBoxes.first();
    
    await expect(firstBox).toHaveClass(/blank/);
    await expect(firstBox).toHaveClass(/visible/);
    
    const bgColor = await firstBox.evaluate(el => 
      window.getComputedStyle(el).backgroundColor
    );
    expect(bgColor).toBeTruthy();
    
    console.log('✅ Letter boxes have proper structure');
    console.log('   Word groups:', groupCount);
  });

  test('should identify and style linking word differently', async ({ page }) => {
    await page.locator('#hintBtn').click();
    await page.waitForResponse(
      response => response.url().includes('/puzzles/get-hint'),
      { timeout: 10000 }
    );
    await page.waitForTimeout(1000);
    
    const linkingGroup = page.locator('.linking-word-group');
    const linkingCount = await linkingGroup.count();
    expect(linkingCount).toBeGreaterThan(0);
    
    const linkingBoxes = page.locator('.letter-box.linking-word');
    const linkingBoxCount = await linkingBoxes.count();
    expect(linkingBoxCount).toBeGreaterThan(0);
    
    console.log('✅ Linking word identified and styled');
    console.log('   Linking word letter count:', linkingBoxCount);
  });

  test('should update hint button state after structure revealed', async ({ page }) => {
    // Locate hint button
    const hintBtn = page.locator('#hintBtn');
    
    // Click hint button and wait for response
    await hintBtn.click();
    await page.waitForResponse(
      response => response.url().includes('/puzzles/get-hint'),
      { timeout: 10000 }
    );
    await page.waitForTimeout(500);
    
    // Verify button state changed
    await expect(hintBtn).toBeDisabled();
    await expect(hintBtn).toContainText('Tap words above');
    
    const bgColor = await hintBtn.evaluate(el => 
      window.getComputedStyle(el).backgroundColor
    );
    expect(bgColor).not.toContain('0, 122, 255'); // No longer blue
    
    console.log('✅ Hint button state updated correctly');
  });

  test('should display feedback message about penalty when hint used', async ({ page }) => {
    await page.locator('#hintBtn').click();
    await page.waitForResponse(
      response => response.url().includes('/puzzles/get-hint'),
      { timeout: 10000 }
    );
    
    const feedback = page.locator('#feedback');
    await expect(feedback).toBeVisible();
    await expect(feedback).toContainText('Word structure revealed');
    await expect(feedback).toContainText('-5 points');
    await expect(feedback).toHaveClass(/incorrect/);
    
    console.log('✅ Penalty feedback displayed');
  });

  test('should allow clicking on non-linking words for additional hints', async ({ page }) => {
    // Reveal word structure first
    await page.locator('#hintBtn').click();
    await page.waitForResponse(
      response => response.url().includes('/puzzles/get-hint'),
      { timeout: 10000 }
    );
    await page.waitForTimeout(2000);
    
    // Verify clickable words exist and have correct styling
    const clickableWords = page.locator('.word-group.clickable-word');
    await expect(clickableWords.first()).toBeVisible();
    
    // Verify they have pointer cursor (indicates clickable)
    const cursor = await clickableWords.first().evaluate(el => 
      window.getComputedStyle(el).cursor
    );
    expect(cursor).toBe('pointer');
    
    console.log('✅ Clickable words are present and styled correctly');
  });

  test('should animate letter boxes when they appear', async ({ page }) => {
    // Reveal word structure first
    await page.locator('#hintBtn').click();
    await page.waitForResponse(
      response => response.url().includes('/puzzles/get-hint'),
      { timeout: 10000 }
    );
    
    // Wait for animation to complete
    await page.waitForTimeout(1000);
    
    // Verify letter boxes appeared with animation classes
    const letterBoxes = page.locator('.letter-box');
    await expect(letterBoxes.first()).toBeVisible();
    await expect(letterBoxes.first()).toHaveClass(/visible/);
    
    console.log('✅ Animation completed - letter boxes visible');
  });
});

// Smoke test - validates the complete critical path
test.describe('Phrasey Chain - Complete Game Flow (Smoke Test)', () => {
  
  test('should complete full game initialization and first hint flow @smoke', async ({ page }) => {
    // Set up API listener before navigation
    const apiPromise = page.waitForResponse(
      response => response.url().includes('/puzzles/today') && response.status() === 200,
      { timeout: 15000 }
    );
    
    // Load intro screen
    await page.goto(BASE_URL);
    
    // Verify intro screen visible
    await expect(page.locator('#introScreen')).toBeVisible();
    
    // Wait for puzzle to load
    const apiResponse = await apiPromise;
    const puzzleData = await apiResponse.json();
    
    // Verify puzzle structure
    expect(puzzleData.clues).toHaveLength(5);
    
    // Start game
    await page.locator('.start-btn').click();
    
    // Verify game screen appeared
    await expect(page.locator('#gameScreen')).toBeVisible();
    
    // Verify first question loaded
    await expect(page.locator('#questionNumber')).toContainText('Question 1 of 5');
    const clueText = await page.locator('#clue').textContent();
    expect(clueText.length).toBeGreaterThan(0);
    
    // Reveal word structure
    await page.locator('#hintBtn').click();
    await page.waitForResponse(
      response => response.url().includes('/puzzles/get-hint'),
      { timeout: 10000 }
    );
    await page.waitForTimeout(1000);
    
    // Verify structure displayed correctly
    const letterBoxes = page.locator('.letter-box');
    const boxCount = await letterBoxes.count();
    expect(boxCount).toBeGreaterThan(0);
    
    // Verify hint button disabled
    await expect(page.locator('#hintBtn')).toBeDisabled();
    
    console.log('✅ SMOKE TEST PASSED - Complete flow working');
    console.log('   Puzzle date:', puzzleData.date);
    console.log('   First clue:', clueText);
    console.log('   Letter boxes displayed:', boxCount);
  });
});
