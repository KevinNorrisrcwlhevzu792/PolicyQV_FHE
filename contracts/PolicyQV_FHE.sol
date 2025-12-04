// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PolicyQV_FHE is SepoliaConfig {
    struct EncryptedVote {
        uint256 id;
        euint32 encryptedPolicyId;  // Encrypted policy identifier
        euint32 encryptedVoteCount; // Encrypted vote count (quadratic)
        euint32 encryptedCredits;   // Encrypted credits spent
        uint256 timestamp;
    }
    
    struct DecryptedVote {
        uint32 policyId;
        uint32 voteCount;
        uint32 credits;
        bool isRevealed;
    }

    struct Policy {
        string title;
        string description;
        euint32 encryptedTotalVotes;
        uint32 decryptedTotalVotes;
    }

    uint256 public voteCount;
    mapping(uint256 => EncryptedVote) public encryptedVotes;
    mapping(uint256 => DecryptedVote) public decryptedVotes;
    mapping(uint256 => Policy) public policies;
    
    uint256[] public policyIds;
    euint32 private encryptedTotalCredits;
    uint32 private decryptedTotalCredits;
    
    mapping(uint256 => uint256) private requestToVoteId;
    
    event VoteSubmitted(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event VoteDecrypted(uint256 indexed id);
    event PolicyAdded(uint256 indexed policyId, string title);
    
    modifier onlyVoter(uint256 voteId) {
        _;
    }
    
    function addPolicy(string memory title, string memory description) public {
        uint256 newId = policyIds.length + 1;
        policyIds.push(newId);
        
        policies[newId] = Policy({
            title: title,
            description: description,
            encryptedTotalVotes: FHE.asEuint32(0),
            decryptedTotalVotes: 0
        });
        
        emit PolicyAdded(newId, title);
    }
    
    function submitEncryptedVote(
        euint32 encryptedPolicyId,
        euint32 encryptedVoteCount,
        euint32 encryptedCredits
    ) public {
        voteCount += 1;
        uint256 newId = voteCount;
        
        encryptedVotes[newId] = EncryptedVote({
            id: newId,
            encryptedPolicyId: encryptedPolicyId,
            encryptedVoteCount: encryptedVoteCount,
            encryptedCredits: encryptedCredits,
            timestamp: block.timestamp
        });
        
        decryptedVotes[newId] = DecryptedVote({
            policyId: 0,
            voteCount: 0,
            credits: 0,
            isRevealed: false
        });
        
        encryptedTotalCredits = FHE.add(encryptedTotalCredits, encryptedCredits);
        
        emit VoteSubmitted(newId, block.timestamp);
    }
    
    function requestVoteDecryption(uint256 voteId) public onlyVoter(voteId) {
        EncryptedVote storage vote = encryptedVotes[voteId];
        require(!decryptedVotes[voteId].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(vote.encryptedPolicyId);
        ciphertexts[1] = FHE.toBytes32(vote.encryptedVoteCount);
        ciphertexts[2] = FHE.toBytes32(vote.encryptedCredits);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptVote.selector);
        requestToVoteId[reqId] = voteId;
        
        emit DecryptionRequested(voteId);
    }
    
    function decryptVote(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 voteId = requestToVoteId[requestId];
        require(voteId != 0, "Invalid request");
        
        EncryptedVote storage eVote = encryptedVotes[voteId];
        DecryptedVote storage dVote = decryptedVotes[voteId];
        require(!dVote.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        
        dVote.policyId = results[0];
        dVote.voteCount = results[1];
        dVote.credits = results[2];
        dVote.isRevealed = true;
        
        Policy storage policy = policies[dVote.policyId];
        policy.encryptedTotalVotes = FHE.add(
            policy.encryptedTotalVotes, 
            FHE.asEuint32(dVote.voteCount)
        );
        policy.decryptedTotalVotes += dVote.voteCount;
        
        decryptedTotalCredits += dVote.credits;
        
        emit VoteDecrypted(voteId);
    }
    
    function getDecryptedVote(uint256 voteId) public view returns (
        uint32 policyId,
        uint32 voteCount,
        uint32 credits,
        bool isRevealed
    ) {
        DecryptedVote storage v = decryptedVotes[voteId];
        return (v.policyId, v.voteCount, v.credits, v.isRevealed);
    }
    
    function getPolicy(uint256 policyId) public view returns (
        string memory title,
        string memory description,
        uint32 totalVotes
    ) {
        Policy storage p = policies[policyId];
        return (p.title, p.description, p.decryptedTotalVotes);
    }
    
    function requestTotalCreditsDecryption() public {
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(encryptedTotalCredits);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptTotalCredits.selector);
        requestToVoteId[reqId] = type(uint256).max;
    }
    
    function decryptTotalCredits(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 voteId = requestToVoteId[requestId];
        require(voteId == type(uint256).max, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 credits = abi.decode(cleartexts, (uint32));
        decryptedTotalCredits = credits;
    }
    
    function getTotalCredits() public view returns (uint32) {
        return decryptedTotalCredits;
    }
    
    function requestPolicyVotesDecryption(uint256 policyId) public {
        euint32 votes = policies[policyId].encryptedTotalVotes;
        require(FHE.isInitialized(votes), "Policy not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(votes);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptPolicyVotes.selector);
        requestToVoteId[reqId] = policyId;
    }
    
    function decryptPolicyVotes(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 policyId = requestToVoteId[requestId];
        require(policyId != 0 && policyId != type(uint256).max, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 votes = abi.decode(cleartexts, (uint32));
        policies[policyId].decryptedTotalVotes = votes;
    }
}