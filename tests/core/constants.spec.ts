/**
 * 核心常量和工具函数单元测试
 */

import { describe, it, expect } from 'vitest'
import {
  MODEL_CATALOG,
  findModelById,
  getModelsByProvider,
  resolveContextLengthFromCatalog,
} from '../../src/core/constants/model-catalog'
import { DEFAULT_SHORTCUTS, ShortcutDef } from '../../src/core/constants/shortcuts'
import { themes, applyTheme, Theme } from '../../src/core/constants/themes'
import {
  getBasename,
  getDirname,
  joinPath,
  splitPath,
  getParentDir,
  getNexusDirName,
} from '../../src/core/utils/path-utils'

describe('model-catalog constants', () => {
  describe('MODEL_CATALOG', () => {
    it('should be an array', () => {
      expect(Array.isArray(MODEL_CATALOG)).toBe(true)
    })

    it('should contain at least one model', () => {
      expect(MODEL_CATALOG.length).toBeGreaterThan(0)
    })

    it('should have required fields for each model', () => {
      MODEL_CATALOG.forEach(model => {
        expect(model.id).toBeDefined()
        expect(model.displayName).toBeDefined()
        expect(model.modelName).toBeDefined()
        expect(model.provider).toBeDefined()
        expect(model.interfaceType).toBeDefined()
        expect(model.defaultApiUrl).toBeDefined()
        expect(model.contextLength).toBeDefined()
        expect(model.sortWeight).toBeDefined()
      })
    })

    it('should have unique IDs', () => {
      const ids = MODEL_CATALOG.map(m => m.id)
      const uniqueIds = new Set(ids)
      expect(ids.length).toBe(uniqueIds.size)
    })

    it('should have valid contextLength (positive number)', () => {
      MODEL_CATALOG.forEach(model => {
        expect(model.contextLength).toBeGreaterThan(0)
      })
    })
  })

  describe('findModelById', () => {
    it('should find existing model', () => {
      const firstModel = MODEL_CATALOG[0]
      const found = findModelById(firstModel.id)
      expect(found).toBeDefined()
      expect(found!.id).toBe(firstModel.id)
    })

    it('should return undefined for non-existent ID', () => {
      expect(findModelById(999999)).toBeUndefined()
    })
  })

  describe('getModelsByProvider', () => {
    it('should filter models by provider', () => {
      const providers = Array.from(new Set(MODEL_CATALOG.map(m => m.provider)))
      
      providers.forEach(provider => {
        const models = getModelsByProvider(provider)
        expect(models.length).toBeGreaterThan(0)
        expect(models.every(m => m.provider === provider)).toBe(true)
      })
    })

    it('should return empty array for unknown provider', () => {
      expect(getModelsByProvider('nonexistent-provider')).toEqual([])
    })
  })

  describe('resolveContextLengthFromCatalog', () => {
    it('should return context length for existing model', () => {
      const firstModel = MODEL_CATALOG[0]
      const contextLength = resolveContextLengthFromCatalog(firstModel.id)
      expect(contextLength).toBe(firstModel.contextLength)
    })

    it('should return undefined for non-existent ID', () => {
      expect(resolveContextLengthFromCatalog(999999)).toBeUndefined()
    })
  })
})

describe('shortcuts constants', () => {
  describe('DEFAULT_SHORTCUTS', () => {
    it('should be an array', () => {
      expect(Array.isArray(DEFAULT_SHORTCUTS)).toBe(true)
    })

    it('should contain at least one shortcut', () => {
      expect(DEFAULT_SHORTCUTS.length).toBeGreaterThan(0)
    })

    it('should have required fields for each shortcut', () => {
      DEFAULT_SHORTCUTS.forEach(shortcut => {
        expect(shortcut.label).toBeDefined()
        expect(typeof shortcut.label).toBe('string')
        expect(shortcut.match).toBeDefined()
        expect(typeof shortcut.match).toBe('function')
        expect(shortcut.action).toBeDefined()
        expect(shortcut.action.type).toBeDefined()
      })
    })

    it('should have unique labels', () => {
      const labels = DEFAULT_SHORTCUTS.map(s => s.label)
      const uniqueLabels = new Set(labels)
      expect(labels.length).toBe(uniqueLabels.size)
    })

    it('should have valid action types', () => {
      const validActions = [
        'cycle-next-panel',
        'close-modal',
        'copy',
        'paste',
        'new-session',
        'close-session',
      ]

      DEFAULT_SHORTCUTS.forEach(shortcut => {
        expect(validActions).toContain(shortcut.action.type)
      })
    })

    it('should have working match functions', () => {
      DEFAULT_SHORTCUTS.forEach(shortcut => {
        // Create a mock keyboard event
        const mockEvent = {
          key: 'Tab',
          ctrlKey: true,
          shiftKey: false,
          altKey: false,
          metaKey: false,
        } as KeyboardEvent

        // Should not throw
        expect(() => shortcut.match(mockEvent)).not.toThrow()
      })
    })
  })
})

describe('themes constants', () => {
  describe('themes', () => {
    it('should be an array', () => {
      expect(Array.isArray(themes)).toBe(true)
    })

    it('should contain at least one theme', () => {
      expect(themes.length).toBeGreaterThan(0)
    })

    it('should have required fields for each theme', () => {
      themes.forEach(theme => {
        expect(theme.id).toBeDefined()
        expect(theme.name).toBeDefined()
        expect(theme.icon).toBeDefined()
        expect(theme.colors).toBeDefined()
        expect(theme.colors.bgPrimary).toBeDefined()
        expect(theme.colors.bgSecondary).toBeDefined()
        expect(theme.colors.textPrimary).toBeDefined()
        expect(theme.colors.accentColor).toBeDefined()
        expect(theme.colors.borderColor).toBeDefined()
      })
    })

    it('should have unique IDs', () => {
      const ids = themes.map(t => t.id)
      const uniqueIds = new Set(ids)
      expect(ids.length).toBe(uniqueIds.size)
    })

    it('should have valid color formats', () => {
      const colorRegex = /^(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|rgba?\([^)]+\))$/
      
      themes.forEach(theme => {
        Object.values(theme.colors).forEach(color => {
          expect(color).toMatch(colorRegex)
        })
      })
    })
  })

  describe('applyTheme', () => {
    it('should apply theme to document', () => {
      const theme = themes[0]
      
      // Mock document.documentElement
      const mockStyle = {
        setProperty: vi.fn(),
      }
      const mockRoot = {
        style: mockStyle,
        setAttribute: vi.fn(),
      }
      
      Object.defineProperty(document, 'documentElement', {
        value: mockRoot,
        writable: true,
      })

      applyTheme(theme)

      expect(mockStyle.setProperty).toHaveBeenCalled()
      expect(mockRoot.setAttribute).toHaveBeenCalledWith('data-theme', theme.id)
    })
  })
})

describe('path-utils', () => {
  describe('getBasename', () => {
    it('should extract filename from path', () => {
      expect(getBasename('/home/user/file.txt')).toBe('file.txt')
      expect(getBasename('/var/log/app.log')).toBe('app.log')
      expect(getBasename('file.txt')).toBe('file.txt')
    })

    it('should handle trailing slash', () => {
      expect(getBasename('/home/user/')).toBe('')
    })

    it('should handle Windows-style paths', () => {
      expect(getBasename('C:\\Users\\file.txt')).toBe('file.txt')
    })
  })

  describe('getDirname', () => {
    it('should extract directory from path', () => {
      expect(getDirname('/home/user/file.txt')).toBe('/home/user')
      expect(getDirname('/var/log')).toBe('/var')
    })

    it('should return "." for relative path without directory', () => {
      expect(getDirname('file.txt')).toBe('.')
    })

    it('should return "/" for root path', () => {
      expect(getDirname('/file.txt')).toBe('/')
    })
  })

  describe('joinPath', () => {
    it('should join path segments', () => {
      expect(joinPath('/home', 'user', 'file.txt')).toBe('/home/user/file.txt')
      expect(joinPath('a', 'b', 'c')).toBe('a/b/c')
    })

    it('should handle multiple slashes', () => {
      expect(joinPath('/home/', '/user/', '/file.txt')).toBe('/home/user/file.txt')
    })

    it('should handle empty segments', () => {
      expect(joinPath('/home', '', 'file.txt')).toBe('/home/file.txt')
    })
  })

  describe('splitPath', () => {
    it('should split path into segments', () => {
      expect(splitPath('/home/user/file.txt')).toEqual(['home', 'user', 'file.txt'])
      expect(splitPath('/var/log')).toEqual(['var', 'log'])
    })

    it('should handle trailing slash', () => {
      expect(splitPath('/home/user/')).toEqual(['home', 'user'])
    })

    it('should handle relative path', () => {
      expect(splitPath('file.txt')).toEqual(['file.txt'])
    })
  })

  describe('getParentDir', () => {
    it('should return parent directory', () => {
      expect(getParentDir('/home/user/file.txt')).toBe('/home/user')
      expect(getParentDir('/var/log')).toBe('/var')
    })

    it('should return empty string for root', () => {
      expect(getParentDir('/file.txt')).toBe('')
    })
  })

  describe('getNexusDirName', () => {
    it('should return directory name', () => {
      const dirName = getNexusDirName()
      expect(typeof dirName).toBe('string')
      expect(dirName.length).toBeGreaterThan(0)
    })
  })
})
