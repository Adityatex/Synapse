import { useState } from 'react';
import { FileProvider } from '../contexts/FileContext';
import Sidebar from '../components/Sidebar';
import TabBar from '../components/TabBar';
import EditorPanel from '../components/EditorPanel';
import Toolbar from '../components/Toolbar';
import OutputPanel from '../components/OutputPanel';

function EditorPage() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('synapse-theme') || 'dark';
  });

  const [output, setOutput] = useState({
    stdout: '',
    stderr: '',
    compile_output: '',
    status: null,
    error: null,
    running: false,
  });

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('synapse-theme', newTheme);
  };

  return (
    <FileProvider>
      <div
        className="flex flex-col h-screen w-screen overflow-hidden"
        data-theme={theme}
      >
        {/* Top Toolbar */}
        <Toolbar
          theme={theme}
          onToggleTheme={toggleTheme}
          output={output}
          setOutput={setOutput}
        />

        {/* Main content area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <Sidebar />

          {/* Editor + Output */}
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Tab bar */}
            <TabBar />

            {/* Editor */}
            <EditorPanel theme={theme} />

            {/* Output */}
            <OutputPanel output={output} />
          </div>
        </div>
      </div>
    </FileProvider>
  );
}

export default EditorPage;
