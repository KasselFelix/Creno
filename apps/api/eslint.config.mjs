import base from '@creno/config/eslint';

export default [
  ...base,
  {
    rules: {
      // Le point d'entrée de date-fns charge ses ~300 fichiers : ~1 s de plus au réveil de l'API.
      // Le front n'est pas concerné, son bundler ne garde que les fonctions utilisées.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'date-fns',
              message:
                "Import ciblé (`date-fns/addDays`) : le point d'entrée ralentit le démarrage.",
            },
          ],
        },
      ],
    },
  },
];
