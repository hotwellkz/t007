import React, { useState, useMemo, useRef, useEffect } from 'react'
import '../App.css'
import { VideoJob, VideoJobStatus } from '../hooks/useVideoJobs'
import { SwipeableJobCard } from './SwipeableJobCard'

interface VideoJobsListProps {
  jobs: VideoJob[]
  activeJobsCount: number
  maxActiveJobs: number
  loading?: boolean
  onApprove?: (jobId: string, jobTitle?: string) => Promise<void>
  onReject?: (jobId: string) => Promise<void>
  onDelete?: (jobId: string) => Promise<void>
  rejectingJobId?: string | null
  approvingJobId?: string | null
  showChannelName?: boolean
}

export const VideoJobsList: React.FC<VideoJobsListProps> = ({
  jobs,
  activeJobsCount,
  maxActiveJobs,
  loading = false,
  onApprove,
  onReject,
  onDelete,
  rejectingJobId = null,
  approvingJobId = null,
  showChannelName = false,
}) => {
  const [filterStatus, setFilterStatus] = useState<VideoJobStatus | 'all'>('all')
  const [sortBy, setSortBy] = useState<'date' | 'status'>('date')
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isFiltersOpen, setIsFiltersOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const filtersRef = useRef<HTMLDivElement>(null)

  const getStatusLabel = (status: VideoJobStatus): string => {
    const labels: Record<VideoJobStatus, string> = {
      queued: 'В очереди',
      sending: 'Отправка в Syntx...',
      waiting_video: 'Ожидаем видео от Syntx...',
      downloading: 'Скачивание видео...',
      ready: 'Готово',
      uploading: 'Загрузка в Google Drive...',
      uploaded: 'Загружено в Google Drive',
      rejected: 'Отклонено',
      error: 'Ошибка',
      syntax_timeout: 'Таймаут',
    }
    return labels[status] || status
  }

  const getStatusColor = (status: VideoJobStatus): string => {
    const colors: Record<VideoJobStatus, string> = {
      queued: '#a0aec0',
      sending: '#4299e1',
      waiting_video: '#4299e1',
      downloading: '#4299e1',
      ready: '#48bb78',
      uploading: '#4299e1',
      uploaded: '#48bb78',
      rejected: '#f56565',
      error: '#f56565',
      syntax_timeout: '#f56565',
    }
    return colors[status] || '#a0aec0'
  }

  const filteredAndSortedJobs = useMemo(() => {
    let filtered = [...jobs]

    // Фильтр по статусу
    if (filterStatus !== 'all') {
      filtered = filtered.filter((job) => job.status === filterStatus)
    }

    // Поиск по названию или промпту
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (job) =>
          job.videoTitle?.toLowerCase().includes(query) ||
          job.prompt.toLowerCase().includes(query) ||
          job.channelName?.toLowerCase().includes(query)
      )
    }

    // Сортировка
    filtered.sort((a, b) => {
      if (sortBy === 'date') {
        return b.createdAt - a.createdAt // Новые сначала
      } else {
        // По статусу: активные сначала, затем по алфавиту
        const activeStatuses: VideoJobStatus[] = ['queued', 'sending', 'waiting_video', 'downloading', 'uploading']
        const aIsActive = activeStatuses.includes(a.status)
        const bIsActive = activeStatuses.includes(b.status)
        
        if (aIsActive && !bIsActive) return -1
        if (!aIsActive && bIsActive) return 1
        
        return getStatusLabel(a.status).localeCompare(getStatusLabel(b.status))
      }
    })

    return filtered
  }, [jobs, filterStatus, searchQuery, sortBy])

  // Закрытие поиска при потере фокуса (только на мобильных)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (isSearchOpen && searchInputRef.current && !searchInputRef.current.contains(e.target as Node)) {
        if (window.innerWidth <= 768) {
          setIsSearchOpen(false)
        }
      }
      if (isFiltersOpen && filtersRef.current && !filtersRef.current.contains(e.target as Node)) {
        setIsFiltersOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [isSearchOpen, isFiltersOpen])

  // Фокус на input при открытии поиска
  useEffect(() => {
    if (isSearchOpen && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [isSearchOpen])

  if (loading && jobs.length === 0) {
    return (
      <div style={{ marginTop: '2rem' }}>
        <p style={{ color: '#718096' }}>Загрузка задач...</p>
      </div>
    )
  }

  return (
    <div className="video-jobs-list">
      <div className="video-jobs-list__header">
        <h3 className="video-jobs-list__title">
          Текущие и последние генерации ({activeJobsCount}/{maxActiveJobs} активных)
        </h3>
        
        {/* Фильтры и поиск */}
        {jobs.length > 0 && (
          <div className="video-jobs-list__controls">
            {/* Поиск - сворачиваемый на мобильных */}
            <div className="search-container">
              {!isSearchOpen ? (
                <button
                  className="search-toggle-button"
                  onClick={() => setIsSearchOpen(true)}
                  aria-label="Открыть поиск"
                >
                  🔍
                </button>
              ) : (
                <div className="search-input-wrapper" ref={searchInputRef}>
                  <input
                    type="text"
                    placeholder="🔍 Поиск..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="search-input"
                    onBlur={() => {
                      // Закрываем только на мобильных, если пусто
                      if (window.innerWidth <= 768 && !searchQuery.trim()) {
                        setTimeout(() => setIsSearchOpen(false), 200)
                      }
                    }}
                  />
                  {searchQuery && (
                    <button
                      className="search-clear-button"
                      onClick={() => {
                        setSearchQuery('')
                        setIsSearchOpen(false)
                      }}
                      aria-label="Очистить поиск"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Фильтры и сортировка - объединены в одну кнопку */}
            <div className="filters-container" ref={filtersRef}>
              <button
                className="filters-toggle-button"
                onClick={() => setIsFiltersOpen(!isFiltersOpen)}
                aria-label="Открыть фильтры"
              >
                ⚙️ Фильтры
              </button>
              
              {isFiltersOpen && (
                <div className="filters-popover">
                  <div className="filters-popover__section">
                    <label className="filters-popover__label">Статус:</label>
                    <select
                      value={filterStatus}
                      onChange={(e) => {
                        setFilterStatus(e.target.value as VideoJobStatus | 'all')
                        setIsFiltersOpen(false)
                      }}
                      className="filters-popover__select"
                    >
                      <option value="all">Все статусы</option>
                      <option value="ready">Готово</option>
                      <option value="waiting_video">Ожидание</option>
                      <option value="downloading">Скачивание</option>
                      <option value="uploaded">Загружено</option>
                      <option value="error">Ошибки</option>
                    </select>
                  </div>
                  
                  <div className="filters-popover__section">
                    <label className="filters-popover__label">Сортировка:</label>
                    <select
                      value={sortBy}
                      onChange={(e) => {
                        setSortBy(e.target.value as 'date' | 'status')
                        setIsFiltersOpen(false)
                      }}
                      className="filters-popover__select"
                    >
                      <option value="date">По дате</option>
                      <option value="status">По статусу</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      
      {jobs.length === 0 ? (
        <p className="video-jobs-list__empty">Задачи ещё не создавались.</p>
      ) : filteredAndSortedJobs.length === 0 ? (
        <p className="video-jobs-list__empty">Задачи не найдены по заданным фильтрам.</p>
      ) : (
        <div className="job-list">
          {filteredAndSortedJobs.map((job) => {
            const isActive = ['queued', 'sending', 'waiting_video', 'downloading', 'uploading'].includes(job.status)
            const canApprove = job.status === 'ready'
            
            return (
              <SwipeableJobCard
                key={job.id}
                job={job}
                isActive={isActive}
                canApprove={canApprove}
                getStatusLabel={getStatusLabel}
                getStatusColor={getStatusColor}
                showChannelName={showChannelName}
                onApprove={onApprove}
                onReject={onReject}
                onDelete={onDelete}
                loading={loading}
                rejectingJobId={rejectingJobId}
                approvingJobId={approvingJobId}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
