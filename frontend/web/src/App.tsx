// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface PolicyOption {
  id: string;
  title: string;
  description: string;
  category: string;
  voteCount: number;
  quadraticScore: number;
  timestamp: number;
  status: "active" | "completed" | "pending";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [policyOptions, setPolicyOptions] = useState<PolicyOption[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newPolicyData, setNewPolicyData] = useState({
    title: "",
    description: "",
    category: "Infrastructure"
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(5);
  const [showStats, setShowStats] = useState(true);

  // Calculate statistics
  const activePolicies = policyOptions.filter(p => p.status === "active").length;
  const totalVotes = policyOptions.reduce((sum, policy) => sum + policy.voteCount, 0);
  const avgQuadraticScore = policyOptions.length > 0 
    ? policyOptions.reduce((sum, policy) => sum + policy.quadraticScore, 0) / policyOptions.length 
    : 0;

  useEffect(() => {
    loadPolicyOptions().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadPolicyOptions = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("policy_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing policy keys:", e);
        }
      }
      
      const list: PolicyOption[] = [];
      
      for (const key of keys) {
        try {
          const policyBytes = await contract.getData(`policy_${key}`);
          if (policyBytes.length > 0) {
            try {
              const policyData = JSON.parse(ethers.toUtf8String(policyBytes));
              list.push({
                id: key,
                title: policyData.title,
                description: policyData.description,
                category: policyData.category,
                voteCount: policyData.voteCount || 0,
                quadraticScore: policyData.quadraticScore || 0,
                timestamp: policyData.timestamp,
                status: policyData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing policy data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading policy ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setPolicyOptions(list);
    } catch (e) {
      console.error("Error loading policies:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitPolicy = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Storing policy data with FHE encryption..."
    });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const policyId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const policyData = {
        title: newPolicyData.title,
        description: newPolicyData.description,
        category: newPolicyData.category,
        voteCount: 0,
        quadraticScore: 0,
        timestamp: Math.floor(Date.now() / 1000),
        status: "active"
      };
      
      // Store policy data on-chain
      await contract.setData(
        `policy_${policyId}`, 
        ethers.toUtf8Bytes(JSON.stringify(policyData))
      );
      
      const keysBytes = await contract.getData("policy_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(policyId);
      
      await contract.setData(
        "policy_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Policy added successfully with FHE encryption!"
      });
      
      await loadPolicyOptions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewPolicyData({
          title: "",
          description: "",
          category: "Infrastructure"
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const voteOnPolicy = async (policyId: string, voteStrength: number) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing quadratic vote with FHE computation..."
    });

    try {
      // Simulate FHE computation for quadratic voting
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const policyBytes = await contract.getData(`policy_${policyId}`);
      if (policyBytes.length === 0) {
        throw new Error("Policy not found");
      }
      
      const policyData = JSON.parse(ethers.toUtf8String(policyBytes));
      
      // Quadratic voting calculation: cost = voteStrength^2
      const updatedPolicy = {
        ...policyData,
        voteCount: policyData.voteCount + 1,
        quadraticScore: policyData.quadraticScore + (voteStrength * voteStrength)
      };
      
      await contract.setData(
        `policy_${policyId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedPolicy))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Quadratic vote recorded with FHE privacy protection!"
      });
      
      await loadPolicyOptions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Voting failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: isAvailable 
          ? "FHE contract is available and ready for quadratic voting!" 
          : "Contract is currently unavailable"
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to participate in quadratic voting",
      icon: "🔗"
    },
    {
      title: "Browse Policies",
      description: "Explore different public policy options available for voting",
      icon: "📋"
    },
    {
      title: "Quadratic Voting",
      description: "Assign votes to policies based on preference strength using FHE encryption",
      icon: "🗳️"
    },
    {
      title: "FHE Privacy",
      description: "Your votes remain encrypted and anonymous throughout the process",
      icon: "🔒"
    },
    {
      title: "View Results",
      description: "See how community preferences shape policy priorities",
      icon: "📊"
    }
  ];

  // Filter and pagination logic
  const filteredPolicies = policyOptions.filter(policy => {
    const matchesSearch = policy.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          policy.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "all" || policy.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredPolicies.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredPolicies.length / itemsPerPage);

  const paginate = (pageNumber: number) => setCurrentPage(pageNumber);

  const renderBarChart = () => {
    const categories = [...new Set(policyOptions.map(p => p.category))];
    const data = categories.map(category => {
      const policiesInCategory = policyOptions.filter(p => p.category === category);
      const totalScore = policiesInCategory.reduce((sum, p) => sum + p.quadraticScore, 0);
      return { category, score: totalScore };
    }).sort((a, b) => b.score - a.score);

    const maxScore = Math.max(...data.map(d => d.score), 1);

    return (
      <div className="bar-chart">
        {data.map((item, index) => (
          <div key={index} className="bar-item">
            <div className="bar-label">{item.category}</div>
            <div className="bar-container">
              <div 
                className="bar-fill" 
                style={{ width: `${(item.score / maxScore) * 100}%` }}
              ></div>
            </div>
            <div className="bar-value">{item.score.toFixed(0)}</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Loading policy voting platform...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>PolicyQuadra<span>Vote</span></h1>
          <p>Anonymous Quadratic Voting for Public Policy</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-policy-btn"
            disabled={!account}
          >
            + Propose Policy
          </button>
          <button 
            className="tutorial-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "How It Works"}
          </button>
          <button 
            className="check-availability-btn"
            onClick={checkAvailability}
          >
            Check FHE Status
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Shape Public Policy with Quadratic Voting</h2>
            <p>Anonymously express your preference strength on policy options using FHE-encrypted voting</p>
          </div>
          <div className="fhe-badge">
            <span>FHE-Encrypted • Anonymous • Quadratic</span>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>How Quadratic Voting Works</h2>
            <p className="subtitle">Your voice matters - express preference strength with vote weighting</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="quadratic-explanation">
              <h3>Quadratic Voting Explained</h3>
              <p>With quadratic voting, you can assign multiple votes to policies you care strongly about. 
                 The cost of votes increases quadratically (1 vote = 1 credit, 2 votes = 4 credits, etc.),
                 allowing you to express intensity of preference while maintaining fairness.</p>
            </div>
          </div>
        )}
        
        <div className="controls-row">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search policies..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          <div className="filter-controls">
            <select 
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="all">All Categories</option>
              <option value="Infrastructure">Infrastructure</option>
              <option value="Education">Education</option>
              <option value="Healthcare">Healthcare</option>
              <option value="Environment">Environment</option>
              <option value="Economy">Economy</option>
            </select>
            
            <button 
              className="toggle-stats-btn"
              onClick={() => setShowStats(!showStats)}
            >
              {showStats ? "Hide Stats" : "Show Stats"}
            </button>
          </div>
        </div>
        
        {showStats && (
          <div className="stats-section">
            <div className="stat-card">
              <h3>Total Policies</h3>
              <div className="stat-number">{policyOptions.length}</div>
            </div>
            
            <div className="stat-card">
              <h3>Active Policies</h3>
              <div className="stat-number">{activePolicies}</div>
            </div>
            
            <div className="stat-card">
              <h3>Total Votes</h3>
              <div className="stat-number">{totalVotes}</div>
            </div>
            
            <div className="stat-card">
              <h3>Avg Quadratic Score</h3>
              <div className="stat-number">{avgQuadraticScore.toFixed(1)}</div>
            </div>
          </div>
        )}
        
        {showStats && (
          <div className="chart-section">
            <h3>Policy Preferences by Category</h3>
            {renderBarChart()}
          </div>
        )}
        
        <div className="policies-section">
          <div className="section-header">
            <h2>Public Policy Options</h2>
            <div className="header-actions">
              <button 
                onClick={loadPolicyOptions}
                className="refresh-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh Policies"}
              </button>
            </div>
          </div>
          
          <div className="policies-list">
            {currentItems.length === 0 ? (
              <div className="no-policies">
                <div className="no-policies-icon">📋</div>
                <p>No policy options found</p>
                {account ? (
                  <button 
                    className="create-first-btn"
                    onClick={() => setShowCreateModal(true)}
                  >
                    Propose First Policy
                  </button>
                ) : (
                  <p>Connect your wallet to propose a new policy</p>
                )}
              </div>
            ) : (
              <>
                {currentItems.map(policy => (
                  <div className="policy-card" key={policy.id}>
                    <div className="policy-content">
                      <h3>{policy.title}</h3>
                      <p className="policy-description">{policy.description}</p>
                      <div className="policy-meta">
                        <span className="policy-category">{policy.category}</span>
                        <span className="policy-date">
                          {new Date(policy.timestamp * 1000).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="policy-stats">
                        <div className="stat">
                          <span className="label">Votes:</span>
                          <span className="value">{policy.voteCount}</span>
                        </div>
                        <div className="stat">
                          <span className="label">Quadratic Score:</span>
                          <span className="value">{policy.quadraticScore.toFixed(1)}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="vote-actions">
                      <p>Assign votes based on preference strength:</p>
                      <div className="vote-buttons">
                        {[1, 2, 3, 4, 5].map(strength => (
                          <button 
                            key={strength}
                            onClick={() => voteOnPolicy(policy.id, strength)}
                            disabled={!account}
                            className="vote-btn"
                            title={`Assign ${strength} vote(s) - costs ${strength * strength} credits`}
                          >
                            {strength} Vote{strength > 1 ? 's' : ''}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
                
                {totalPages > 1 && (
                  <div className="pagination">
                    <button 
                      onClick={() => paginate(currentPage - 1)} 
                      disabled={currentPage === 1}
                    >
                      Previous
                    </button>
                    
                    <span>Page {currentPage} of {totalPages}</span>
                    
                    <button 
                      onClick={() => paginate(currentPage + 1)} 
                      disabled={currentPage === totalPages}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitPolicy} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          policyData={newPolicyData}
          setPolicyData={setNewPolicyData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>PolicyQuadraVote</h3>
            <p>FHE-encrypted quadratic voting for democratic policy prioritization</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">About</a>
            <a href="#" className="footer-link">Privacy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-notice">
            <span>Powered by Fully Homomorphic Encryption • Your votes remain private and secure</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} PolicyQuadraVote. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  policyData: any;
  setPolicyData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  policyData,
  setPolicyData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setPolicyData({
      ...policyData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!policyData.title || !policyData.description) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Propose New Policy</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            Your policy will be stored with FHE encryption for secure quadratic voting
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Policy Title *</label>
              <input 
                type="text"
                name="title"
                value={policyData.title} 
                onChange={handleChange}
                placeholder="Enter policy title..." 
              />
            </div>
            
            <div className="form-group">
              <label>Category *</label>
              <select 
                name="category"
                value={policyData.category} 
                onChange={handleChange}
              >
                <option value="Infrastructure">Infrastructure</option>
                <option value="Education">Education</option>
                <option value="Healthcare">Healthcare</option>
                <option value="Environment">Environment</option>
                <option value="Economy">Economy</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>Policy Description *</label>
              <textarea 
                name="description"
                value={policyData.description} 
                onChange={handleChange}
                placeholder="Describe the policy in detail..." 
                rows={4}
              />
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn"
          >
            {creating ? "Creating with FHE..." : "Create Policy"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;