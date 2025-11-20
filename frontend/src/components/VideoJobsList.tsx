import React, { useState, useMemo } from 'react'
import '../App.css'
import { VideoJob, VideoJobStatus } from '../hooks/useVideoJobs'

interface VideoJobsListProps {
  jobs: VideoJob[]
  activeJobsCount: number
  maxActiveJobs: number
  loading?: boolean
  onApprove?: (jobId: string, jobTitle?: string) => Promise<void>
  onReject?: (jobId: string) => Promise<void>
  rejectingJobId?: string | null
  showChannelName?: boolean
}

export const VideoJobsList: React.FC<VideoJobsListProps> = ({
  jobs,
  activeJobsCount,
  maxActiveJobs,
  loading = false,
  onApprove,
  onReject,
  rejectingJobId = null,
  showChannelName = false,
}) => {
  const [filterStatus, setFilterStatus] = useState<VideoJobStatus | 'all'>('all')
  const [sortBy, setSortBy] = useState<'date' | 'status'>('date')
  const [searchQuery, setSearchQuery] = useState('')

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

  if (loading && jobs.length === 0) {
    return (
      <div style={{ marginTop: '2rem' }}>
        <p style={{ color: '#718096' }}>Загрузка задач...</p>
      </div>
    )
  }

  return (
    <div style={{ marginTop: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h3 style={{ margin: 0 }}>
          Текущие и последние генерации ({activeJobsCount}/{maxActiveJobs} активных)
        </h3>
        
        {/* Фильтры и поиск */}
        {jobs.length > 0 && (
          <div className="filter-sort-controls">
            <input
              type="text"
              placeholder="🔍 Поиск по названию или промпту..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ flex: 1, minWidth: '200px' }}
            />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as VideoJobStatus | 'all')}
            >
              <option value="all">Все статусы</option>
              <option value="ready">Готово</option>
              <option value="waiting_video">Ожидание</option>
              <option value="downloading">Скачивание</option>
              <option value="uploaded">Загружено</option>
              <option value="error">Ошибки</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'date' | 'status')}
            >
              <option value="date">По дате</option>
              <option value="status">По статусу</option>
            </select>
          </div>
        )}
      </div>
      
      {jobs.length === 0 ? (
        <p style={{ color: '#718096', marginTop: '0.75rem' }}>Задачи ещё не создавались.</p>
      ) : filteredAndSortedJobs.length === 0 ? (
        <p style={{ color: '#718096', marginTop: '0.75rem' }}>Задачи не найдены по заданным фильтрам.</p>
      ) : (
        <div className="job-list">
          {filteredAndSortedJobs.map((job) => {
            const isActive = ['queued', 'sending', 'waiting_video', 'downloading', 'uploading'].includes(job.status)
            const canApprove = job.status === 'ready'
            
            return (
              <div
                key={job.id}
                className={`job-card ${isActive ? 'job-card--active' : ''}`}
                data-job-id={job.id}
              >
                <div className="job-card__header">
                  <div className="job-card__info">
                    <h4>
                      {job.videoTitle || job.prompt.substring(0, 60) + (job.prompt.length > 60 ? '...' : '')}
                    </h4>
                    {job.videoTitle && (
                      <p className="job-card__prompt">
                        {job.prompt.substring(0, 100) + (job.prompt.length > 100 ? '...' : '')}
                      </p>
                    )}
                    {showChannelName && job.channelName && (
                      <p style={{ fontSize: '0.875rem', color: '#718096', marginTop: '0.25rem' }}>
                        Канал: {job.channelName}
                      </p>
                    )}
                    <div className="job-card__status">
                      <span
                        className="job-card__status-dot"
                        style={{ background: getStatusColor(job.status) }}
                      />
                      <span style={{ color: getStatusColor(job.status) }}>
                        {getStatusLabel(job.status)}
                      </span>
                      {job.errorMessage && (
                        <span className="job-card__error">
                          {job.errorMessage}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="job-card__timestamp">
                    {new Date(job.createdAt).toLocaleString('ru-RU')}
                  </div>
                </div>

                {/* Превью видео для готовых задач */}
                {job.status === 'ready' && job.previewUrl && (
                  <div className="job-card__preview">
                    <video
                      src={job.previewUrl}
                      controls
                      className="video-preview"
                    />
                  </div>
                )}

                {/* Действия для готовых задач */}
                {canApprove && onApprove && (
                  <div className="job-card__actions">
                    <button
                      className="button button-success"
                      onClick={() => onApprove(job.id, job.videoTitle)}
                      disabled={loading || job.status === 'uploaded'}
                    >
                      ✅ Одобрить и отправить в Google Drive
                    </button>
                    {onReject && (
                      <button
                        className="button button-danger"
                        onClick={() => onReject(job.id)}
                        disabled={loading || rejectingJobId === job.id}
                        title={rejectingJobId === job.id ? 'Отклонение...' : 'Отклонить видео'}
                      >
                        {rejectingJobId === job.id ? '⏳ Отклонение...' : '🗑 Отклонить'}
                      </button>
                    )}
                  </div>
                )}

                {/* Ссылка на Google Drive для загруженных */}
                {job.status === 'uploaded' && job.webViewLink && (
                  <div className="job-card__link">
                    <a
                      href={job.webViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Открыть в Google Drive
                    </a>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

