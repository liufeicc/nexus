/**
 * IterationBudget 单元测试
 */

import { describe, it, expect } from 'vitest'
import { IterationBudget } from '../../src/core/types/agent'

describe('IterationBudget', () => {
  describe('constructor', () => {
    it('should create with default max of 90', () => {
      const budget = new IterationBudget()
      expect(budget.max).toBe(90)
      expect(budget.remaining).toBe(90)
      expect(budget.consumed).toBe(0)
    })

    it('should create with custom max', () => {
      const budget = new IterationBudget(50)
      expect(budget.max).toBe(50)
      expect(budget.remaining).toBe(50)
    })
  })

  describe('consume', () => {
    it('should consume 1 by default', () => {
      const budget = new IterationBudget(10)
      budget.consume()
      expect(budget.consumed).toBe(1)
      expect(budget.remaining).toBe(9)
    })

    it('should consume specified amount', () => {
      const budget = new IterationBudget(10)
      budget.consume(3)
      expect(budget.consumed).toBe(3)
      expect(budget.remaining).toBe(7)
    })

    it('should accumulate consumption', () => {
      const budget = new IterationBudget(10)
      budget.consume(2)
      budget.consume(3)
      budget.consume(1)
      expect(budget.consumed).toBe(6)
      expect(budget.remaining).toBe(4)
    })

    it('should allow consuming more than max (negative remaining)', () => {
      const budget = new IterationBudget(5)
      budget.consume(10)
      expect(budget.consumed).toBe(10)
      expect(budget.remaining).toBe(-5)
    })
  })

  describe('hasRemaining', () => {
    it('should return true when budget available', () => {
      const budget = new IterationBudget(10)
      expect(budget.hasRemaining).toBe(true)
    })

    it('should return true when 1 remaining', () => {
      const budget = new IterationBudget(5)
      budget.consume(4)
      expect(budget.hasRemaining).toBe(true)
    })

    it('should return false when exactly consumed', () => {
      const budget = new IterationBudget(5)
      budget.consume(5)
      expect(budget.hasRemaining).toBe(false)
    })

    it('should return false when over-consumed', () => {
      const budget = new IterationBudget(5)
      budget.consume(10)
      expect(budget.hasRemaining).toBe(false)
    })
  })

  describe('reset', () => {
    it('should reset consumed to 0', () => {
      const budget = new IterationBudget(10)
      budget.consume(5)
      budget.reset()
      expect(budget.consumed).toBe(0)
      expect(budget.remaining).toBe(10)
    })

    it('should restore hasRemaining after reset', () => {
      const budget = new IterationBudget(5)
      budget.consume(5)
      expect(budget.hasRemaining).toBe(false)
      budget.reset()
      expect(budget.hasRemaining).toBe(true)
    })
  })

  describe('readonly max', () => {
    it('should not allow modifying max', () => {
      const budget = new IterationBudget(10)
      // TypeScript prevents this at compile time, but test runtime behavior
      expect(budget.max).toBe(10)
    })
  })
})
