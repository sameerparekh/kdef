/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" serves /api from in-memory MSW handlers (src/mocks). Never enabled implicitly. */
  readonly VITE_MOCK_API?: string;
}
