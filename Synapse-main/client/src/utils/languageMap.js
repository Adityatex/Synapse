// Judge0 language IDs mapped to file extensions and display names
export const LANGUAGES = [
  { id: 71, name: 'Python', extension: '.py', monacoLang: 'python', icon: '🐍', template: '# Python 3\nprint("Hello, Synapse!")' },
  { id: 63, name: 'JavaScript', extension: '.js', monacoLang: 'javascript', icon: '⚡', template: '// JavaScript (Node.js)\nconsole.log("Hello, Synapse!");' },
  { id: 54, name: 'C++', extension: '.cpp', monacoLang: 'cpp', icon: '⚙️', template: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, Synapse!" << endl;\n    return 0;\n}' },
  { id: 62, name: 'Java', extension: '.java', monacoLang: 'java', icon: '☕', template: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, Synapse!");\n    }\n}' },
];

export const getLanguageByExtension = (filename) => {
  const ext = '.' + filename.split('.').pop().toLowerCase();
  return LANGUAGES.find(lang => lang.extension === ext) || LANGUAGES[0];
};

export const getLanguageById = (id) => {
  return LANGUAGES.find(lang => lang.id === id) || LANGUAGES[0];
};

export const getMonacoLanguage = (filename) => {
  return getLanguageByExtension(filename).monacoLang;
};
