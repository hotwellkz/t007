import React, { useState } from 'react'
import { useVideoJobs } from '../hooks/useVideoJobs'
import { VideoJobsList } from '../components/VideoJobsList'
import { apiFetch } from '../lib/apiClient'
import { useToast } from '../hooks/useToast'
import '../App.css'

const VideoJobsHistory: React.FC = () => {
  const [rejectingJobId, setRejectingJobId] = useState<string | null>(null)
  const toast = useToast()
  
  // Загружаем все задачи (без фильтра по каналу)
  const {
    videoJobs,
    activeJobsCount,
    maxActiveJobs,
    loading,
    error,
    refreshJobs,
  } = useVideoJobs({
    channelId: null, // null означает загрузить все задачи
    autoPoll: true,
    pollInterval: 3000,
  })

  const handleApproveJob = async (jobId: string, jobTitle?: string) => {
    try {
      await apiFetch(`/api/video-jobs/${jobId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoTitle: jobTitle?.trim() || undefined,
        }),
      })
      toast.success('Видео успешно загружено в Google Drive!')
      await refreshJobs()
    } catch (err: any) {
      toast.error(err.message || 'Ошибка при одобрении видео')
    }
  }

  const handleRejectJob = async (jobId: string) => {
    const job = videoJobs.find(j => j.id === jobId)
    const jobName = job?.videoTitle || job?.prompt.substring(0, 50) || 'это видео'
    
    if (!window.confirm(`Вы уверены, что хотите отклонить "${jobName}"? Это действие нельзя отменить.`)) {
      return
    }
    
    setRejectingJobId(jobId)
    
    try {
      const response = await apiFetch(`/api/video-jobs/${jobId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || errorData.message || `Ошибка ${response.status}`)
      }
      
      toast.success('Видео отклонено')
      await refreshJobs()
    } catch (err: any) {
      toast.error(err.message || 'Ошибка при отклонении видео')
    } finally {
      setRejectingJobId(null)
    }
  }

  return (
    <div className="card">
      <h2>История генераций</h2>
      
      {error && (
        <div className="error" style={{ marginTop: '1rem' }}>
          {error}
        </div>
      )}

      <VideoJobsList
        jobs={videoJobs}
        activeJobsCount={activeJobsCount}
        maxActiveJobs={maxActiveJobs}
        loading={loading}
        onApprove={handleApproveJob}
        onReject={handleRejectJob}
        rejectingJobId={rejectingJobId}
        showChannelName={true}
      />
    </div>
  )
}

export default VideoJobsHistory

