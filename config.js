// Configuração do app da Web do Firebase (projeto papo-flash).
// Estas informações não são senha: podem ficar no GitHub sem problema.
export const firebaseConfig = {
  apiKey: 'AIzaSyB_fxdLygB_3avJnj7ICQ6wFrnJUJl8zDQ',
  authDomain: 'papo-flash.firebaseapp.com',
  projectId: 'papo-flash',
  storageBucket: 'papo-flash.firebasestorage.app',
  messagingSenderId: '249702972151',
  appId: '1:249702972151:web:0f6db80f73f6671d74f1f2',
};


// Chamadas de voz e vídeo: "ponte" (TURN) para quando a ligação não conecta (ex.: no 4G).
// Cole aqui o endereço de credenciais da Metered (termina com ?apiKey=...).
export const turnCredentialsUrl = '';
export const iceServers = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  {
    urls: [
      'turn:br.relay.metered.ca:80',
      'turn:br.relay.metered.ca:80?transport=tcp',
      'turn:br.relay.metered.ca:443',
      'turns:br.relay.metered.ca:443?transport=tcp',
    ],
    username: '050c90beb822229cb83e8455',
    credential: 'JA+kiaAc5iL3wyO3',
  },
];

// Avisos no celular com o app fechado (o "carteiro" fica no servidor do Baamboofree).
export const pushServer = 'https://baamboofree.onrender.com/papo';
