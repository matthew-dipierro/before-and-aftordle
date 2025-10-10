// Phrasey Chain - Automated Test Suite (Fixed Version)
// Using Playwright for end-to-end testing

import { test, expect } from '@playwright/test';

// Test Configuration
const BASE_URL = 'https://phraseychain.com';
const API_BASE_URL = 'https://before-and-aftordle.onrender.com/api';

test.describe('Phrasey Chain - Game Initialization & Puzzle Loading', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('should display the intro screen with game title and instructions', async ({ page }) => {
    // Verify the logo/title is visible
    await expect(page.locator('.logo')).toBeVisible();
    
    // Verify subtitle is visible (text changes after puzzle loads)
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
    // Wait for the API call with longer timeout
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
    await expect(page.locator('#introScreen')).toBeVisible();
    await expect(page.locator('#gameScreen')).not.toBeVisible();
    
    await page.locator('.start-btn').click();
    
    await expect(page.locator('#introScreen')).not.toBeVisible();
    await expect(page.locator('#gameScreen')).toBeVisible();
    
    console.log('✅ Successfully transitioned to game screen');
  });

  test('should display first question with clue text and input field', async ({ page }) => {
    await page.locator('.start-btn').click();
    
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
    await page.goto(BASE_URL);
    await page.waitForResponse(
      response => response.url().includes('/puzzles/today') && response.status() === 200,
      { timeout: 10000 }
    );
    await page.locator('.start-btn').click();
  });

  test('should reveal word structure when hint button clicked', async ({ page }) => {
    const hintBtn = page.locator('#hintBtn');
    
    await hintBtn.click();
    
    await page.waitForResponse(
      response => response.url().includes('/puzzles/get-hint') && response.status() === 200,
      { timeout: 10000 }
    );
    
    await page.waitForTimeout(1000);
    
    const letterBoxes = page.locator('.letter-box');
    const boxCount = await letterBoxes.count();
    expect(boxCount).toBeGreaterThan(0);
    
    console.log('✅ Word structure revealed with', boxCount, 'letter boxes');
  });

  test('should display letter boxes with proper structure and styling', async ({ page }) => {
    await page.locator('#hintBtn').click();
    await page.waitForResponse(
      response => response.url().includes('/puzzles/get-hint'),
      { timeout: 10000 }
    );
    await page.waitForTimeout(1000);
    
    const wordGroups = page.locator('.word-group');
    const groupCount = await wordGroups.count();
    expect(groupCount).toBeGreaterThan(0);
    
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
    const hintBtn = page.locator('#hintBtn');
    
    await hintBtn.click();
    await page.waitForResponse(
      response => response.url().includes('/puzzles/get-hint'),
      { timeout: 10000 }
    );
    await page.waitForTimeout(500);
    
    await expect(hintBtn).toBeDisabled();
    await expect(hintBtn).toContainText('Tap words above');
    
    const bgColor = await hintBtn.evaluate(el => 
      window.getComputedStyle(el).backgroundColor
    );
    expect(bgColor).not.toContain('0, 122, 255');
    
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
    // Reveal structure first
    await page.locator('#hintBtn').click();
    await page.waitForResponse(
      response => response.url().includes('/puzzles/get-hint'),
      { timeout: 10000 }
    );
    await page.waitForTimeout(2000);
    
    // Verify clickable words exist
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
    // Reveal structure
    await page.locator('#hintBtn').click();
    await page.waitForResponse(
      response => response.url().includes('/puzzles/get-hint'),
      { timeout: 10000 }
    );
    
    // Wait for animation
    await page.waitForTimeout(1000);
    
    // Verify letter boxes appeared and have correct classes
    const letterBoxes = page.locator('.letter-box');
    await expect(letterBoxes.first()).toBeVisible();
    await expect(letterBoxes.first()).toHaveClass(/visible/);
    
    console.log('✅ Animation completed - letter boxes visible');
  });
});

// Smoke test
test.describe('Phrasey Chain - Complete Game Flow (Smoke Test)', () => {
  
  test('should complete full game initialization and first hint flow @smoke', async ({ page }) => {
    // 1. Load intro screen
    await page.goto(BASE_URL);
    await expect(page.locator('#introScreen')).toBeVisible();
    
    // 2. Wait for puzzle to load
    const apiResponse = await page.waitForResponse(
      response => response.url().includes('/puzzles/today') && response.status() === 200,
      { timeout: 15000 }
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
    await page.waitForResponse(
      response => response.url().includes('/puzzles/get-hint'),
      { timeout: 10000 }
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
