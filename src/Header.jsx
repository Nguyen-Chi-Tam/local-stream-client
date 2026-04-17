import React, { useState, useEffect, useRef } from 'react';
import { Menu, X, Music, Video, Image, Server } from 'lucide-react';

export default function Header({ title, serverUrl, activeSection, onNavigate, onChangeServer }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    }
    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

  const handleNavigate = (path) => {
    onNavigate(path);
    setIsMenuOpen(false);
  };

  const handleChangeServer = () => {
    onChangeServer();
    setIsMenuOpen(false);
  };

  return (
    <header className="top-bar">
      <div className="top-bar-left">
        <h1>{title}</h1>
        {serverUrl && (
          <a
            className="server-label"
            href={serverUrl}
            target="_blank"
            rel="noreferrer"
          >
            {`Connected to ${serverUrl}`}
          </a>
        )}
      </div>

      <div className="top-bar-center desktop-only">
        <div className="media-nav" role="tablist" aria-label="Media sections">
          <button
            className={`nav-item ${activeSection === 'music' ? 'active' : ''}`}
            onClick={() => handleNavigate('/media')}
            role="tab"
            aria-selected={activeSection === 'music'}
          >
            <Music size={16} />
            <span>Music</span>
          </button>
          <button
            className={`nav-item ${activeSection === 'video' ? 'active' : ''}`}
            onClick={() => handleNavigate('/media/video')}
            role="tab"
            aria-selected={activeSection === 'video'}
          >
            <Video size={16} />
            <span>Video</span>
          </button>
          <button
            className={`nav-item ${activeSection === 'photo' ? 'active' : ''}`}
            onClick={() => handleNavigate('/media/photo')}
            role="tab"
            aria-selected={activeSection === 'photo'}
          >
            <Image size={16} />
            <span>Photo</span>
          </button>
        </div>
      </div>

      <div className="top-bar-right">
        <button 
          className="secondary desktop-only" 
          onClick={handleChangeServer}
        >
          <Server size={16} />
          <span>Change Server</span>
        </button>

        <div className="mobile-only" ref={menuRef}>
          <button
            className="menu-button"
            onClick={toggleMenu}
            aria-label="Toggle menu"
            aria-expanded={isMenuOpen}
          >
            {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          {isMenuOpen && (
            <div className="menu-dropdown">
              <button
                className={`menu-item ${activeSection === 'music' ? 'active' : ''}`}
                onClick={() => handleNavigate('/media')}
              >
                <Music size={18} />
                <span>Music</span>
              </button>
              <button
                className={`menu-item ${activeSection === 'video' ? 'active' : ''}`}
                onClick={() => handleNavigate('/media/video')}
              >
                <Video size={18} />
                <span>Video</span>
              </button>
              <button
                className={`menu-item ${activeSection === 'photo' ? 'active' : ''}`}
                onClick={() => handleNavigate('/media/photo')}
              >
                <Image size={18} />
                <span>Photo</span>
              </button>
              <div className="menu-divider" />
              <button className="menu-item" onClick={handleChangeServer}>
                <Server size={18} />
                <span>Change Server</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
