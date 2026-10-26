// Web Worker for Microphone Processing
// هذا الكود يعمل في خلفية المتصفح لمعالجة الصوت

self.onmessage = function(e) {
    const { action, data } = e.data;
    
    switch(action) {
        case 'processAudio':
            // معالجة البيانات الصوتية
            processAudioData(data);
            break;
        case 'checkPermission':
            checkMicrophonePermission();
            break;
        default:
            console.log('Unknown action:', action);
    }
};

function processAudioData(audioData) {
    // معالجة بيانات الصوت وإرسال النتيجة
    self.postMessage({
        type: 'audioProcessed',
        result: audioData
    });
}

function checkMicrophonePermission() {
    // التحقق من حالة إذن الميكروفون
    if (navigator.permissions) {
        navigator.permissions.query({ name: 'microphone' })
            .then(permissionStatus => {
                self.postMessage({
                    type: 'permissionStatus',
                    state: permissionStatus.state
                });
                
                permissionStatus.onchange = () => {
                    self.postMessage({
                        type: 'permissionStatus',
                        state: permissionStatus.state
                    });
                };
            });
    }
}

console.log('✅ Mic Worker loaded');
