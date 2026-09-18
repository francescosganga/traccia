import { defineConfig } from 'vitest/config'

// Only the sources: the default glob would also pick up test files in .claude/worktrees.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts']
  }
})
