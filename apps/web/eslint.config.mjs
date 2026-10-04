import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

export default [
  ...nextCoreWebVitals,
  {
    // eslint-config-next@16 trae reglas nuevas más estrictas (react-hooks v7 +
    // algunas de Next) que marcan patrones preexistentes y válidos (p. ej.
    // setState dentro de useEffect para data-fetching). Las dejamos como
    // WARNING, no error: el CI no se rompe por el upgrade de tooling y la señal
    // queda visible para una limpieza incremental.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/static-components': 'warn',
      '@next/next/no-html-link-for-pages': 'warn',
    },
  },
  { ignores: ['.next/**', 'node_modules/**'] },
];
