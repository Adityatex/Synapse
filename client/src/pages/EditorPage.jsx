import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileProvider } from '../contexts/FileContext';
import { useAuth } from '../context/useAuth';
import Sidebar from '../components/Sidebar';
import TabBar from '../components/TabBar';
import EditorPanel from '../components/EditorPanel';
import Toolbar from '../components/Toolbar';
import OutputPanel from '../components/OutputPanel';
import StatusBar from '../components/StatusBar';
import NeuraPanel from '../components/NeuraPanel';
import { readStorage, writeStorage } from '../utils/storage';

function EditorPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [theme, setTheme] = useState(() => {
    return readStorage('synapse-theme') || 'dark';
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
    writeStorage('synapse-theme', newTheme);
  };

  const handleExit = useCallback(() => {
    navigate('/dashboard');
  }, [navigate]);

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
          setOutput={setOutput}
          onExit={handleExit}
          currentUser={user}
        />

        {/* Main content area */}
        <div className={`flex flex-1 overflow-hidden p-2 gap-2 ${theme === 'dark' ? 'bg-[#030509]' : 'bg-slate-200/60'}`}>
          {/* Sidebar */}
          <Sidebar theme={theme} />

          {/* Editor + Output */}
          <div className={`flex flex-col flex-1 min-w-0 overflow-hidden rounded-xl border shadow-lg ${theme === 'dark' ? 'border-white/10 shadow-black/50' : 'border-slate-300 shadow-slate-200/50'}`}>
            {/* Tab bar */}
            <TabBar theme={theme} />

            {/* Editor */}
            <EditorPanel theme={theme} />

            {/* Output */}
            <OutputPanel theme={theme} output={output} />
          </div>

          {/* Neura AI Sidebar */}
          <NeuraPanel theme={theme} />
        </div>

        {/* Status Bar */}
        <StatusBar theme={theme} peersCount={0} />
      </div>
    </FileProvider>
  );
}

export default EditorPage;
