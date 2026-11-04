import path from 'node:path';
// alias: { 'commented': './nope' }
export default {
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      { find: '#root', replacement: '/src' },
      { find: /^~(.*)$/, replacement: '$1' },
    ],
  },
};
